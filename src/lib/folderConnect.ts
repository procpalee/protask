/**
 * 로컬 폴더 ↔ 보드 연결 (브라우저 File System Access API).
 *
 * folder_sync.py(파이썬 CLI)의 브라우저판: 폴더의 마크다운 체크박스(- [ ]/- [x])를
 * 보드에 거울 동기화한다. 폴더 = 프로젝트(workspaces), 체크리스트 파일 = 서브프로젝트(projects),
 * 줄 = 태스크(tasks). git 훅이 없으므로 자동(커밋시) 동기화는 없고, '동기화' 버튼으로 수동 실행.
 *
 * 디렉터리 핸들은 IndexedDB에 영속(브라우저별). 데스크탑 Chrome/Edge 등 File System Access 지원 필요.
 * 파이썬판과 ws id 산출만 다르다(브라우저는 절대경로를 모름 → 연결 시 1회 난수 id를 IDB에 저장).
 * 그 외 pr/task id·파싱·reconcile·개요블록은 동일 규칙.
 */
import { supabase } from './supabase'
import { useStore } from '../store/store'

const SEP = '\x1f'
const GAP = 1024
const MARK_START = '<!--folder-sync-->'
const MARK_END = '<!--/folder-sync-->'
const ITEM_RE = /^\s*[-*]\s+\[([ xX])\]\s+(.+?)\s*$/
const H1_RE = /^#\s+(.+?)\s*$/
const DB_NAME = 'protask-folders'
const STORE = 'folders'

export interface FolderMeta {
  id: string // ws_xxxxxxxxxxxx
  name: string
  handle: FileSystemDirectoryHandle
  checklists: string[] // 상대경로(기본 ['TODO.md'])
  overview: string | null // 개요 소스 md(기본 'README.md')
  lastSync: string | null
}

export const fsSupported = typeof window !== 'undefined' && 'showDirectoryPicker' in window

/* ───────────────────────── IndexedDB ───────────────────────── */

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDB().then(
    db =>
      new Promise<T>((resolve, reject) => {
        const r = fn(db.transaction(STORE, mode).objectStore(STORE))
        r.onsuccess = () => resolve(r.result)
        r.onerror = () => reject(r.error)
      }),
  )
}

export async function listFolders(): Promise<FolderMeta[]> {
  try {
    return (await tx<FolderMeta[]>('readonly', s => s.getAll() as IDBRequest<FolderMeta[]>)) ?? []
  } catch {
    return []
  }
}
export const saveFolder = (m: FolderMeta) => tx('readwrite', s => s.put(m))
export const removeFolder = (id: string) => tx('readwrite', s => s.delete(id))

/* ───────────────────────── helpers ───────────────────────── */

async function sha1hex12(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s))
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 12)
}
function randId(prefix: string): string {
  const a = new Uint8Array(6)
  crypto.getRandomValues(a)
  return `${prefix}_${[...a].map(b => b.toString(16).padStart(2, '0')).join('')}`
}
const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function parseChecklist(text: string): { title: string | null; items: { text: string; done: boolean }[] } {
  let title: string | null = null
  const items: { text: string; done: boolean }[] = []
  for (const line of text.split(/\r?\n/)) {
    if (title === null) {
      const h = H1_RE.exec(line)
      if (h) title = h[1]
    }
    const m = ITEM_RE.exec(line)
    if (m) items.push({ text: m[2], done: m[1].toLowerCase() === 'x' })
  }
  return { title, items }
}

/** 핸들에서 상대경로(폴더/파일.md) 파일 텍스트 읽기. 없으면 null */
async function readRel(dir: FileSystemDirectoryHandle, rel: string): Promise<string | null> {
  const parts = rel.split('/').filter(Boolean)
  let cur: FileSystemDirectoryHandle = dir
  try {
    for (let i = 0; i < parts.length - 1; i++) cur = await cur.getDirectoryHandle(parts[i])
    const fh = await cur.getFileHandle(parts[parts.length - 1])
    return await (await fh.getFile()).text()
  } catch {
    return null
  }
}

/* ───────────────────────── 동기화 ───────────────────────── */

async function ensurePermission(handle: FileSystemDirectoryHandle): Promise<void> {
  // queryPermission/requestPermission은 표준 타입에 아직 없어 캐스팅
  const h = handle as unknown as {
    queryPermission?: (o: { mode: string }) => Promise<PermissionState>
    requestPermission?: (o: { mode: string }) => Promise<PermissionState>
  }
  if ((await h.queryPermission?.({ mode: 'read' })) === 'granted') return
  if ((await h.requestPermission?.({ mode: 'read' })) !== 'granted') throw new Error('폴더 읽기 권한이 거부되었습니다.')
}

async function writeOverview(
  wsId: string,
  name: string,
  ovText: string | null,
  summaries: [string, number, number][],
  done: number,
  total: number,
): Promise<void> {
  const pct = total ? Math.round((done / total) * 100) : 0
  const lines = [`## 📁 folder-sync (앱 연결)`, `- 이름: ${name}`, `- 진척: ${done}/${total} (${pct}%)`, `- 마지막 동기화: ${new Date().toISOString()}`]
  if (summaries.length) {
    lines.push('')
    for (const [t, d, n] of summaries) lines.push(`  - ${t}: ${d}/${n}`)
  }
  const status = lines.join('\n')
  const inner = ovText && ovText.trim() ? `${ovText.trim()}\n\n---\n\n${status}` : status
  const seg = `${MARK_START}\n${inner}\n${MARK_END}`
  const { data } = await supabase.from('workspace_canvas').select('notes').eq('workspace_id', wsId).maybeSingle()
  const old = (data?.notes as string) || ''
  let next: string
  if (old.includes(MARK_START) && old.includes(MARK_END)) {
    next = old.replace(new RegExp(`${escapeRe(MARK_START)}[\\s\\S]*?${escapeRe(MARK_END)}`), () => seg)
  } else if (old.trim()) {
    next = `${old.replace(/\s+$/, '')}\n\n${seg}`
  } else {
    next = seg
  }
  // notes만 upsert → 기존 scene(엑스칼리드로우) 보존
  await supabase.from('workspace_canvas').upsert({ workspace_id: wsId, notes: next })
}

/** 폴더 1개 동기화. 보드에 반영 후 스토어 refetch. 반환: 진척 요약 */
export async function syncFolder(meta: FolderMeta): Promise<{ done: number; total: number; files: number }> {
  await ensurePermission(meta.handle)
  const wsId = meta.id
  await supabase.from('workspaces').upsert({ id: wsId, name: meta.name })

  let totalItems = 0
  let totalDone = 0
  const summaries: [string, number, number][] = []
  const checklists = meta.checklists?.length ? meta.checklists : ['TODO.md']

  for (const rel of checklists) {
    const text = await readRel(meta.handle, rel)
    if (text == null) continue
    const { title, items } = parseChecklist(text)
    const prId = `pr_${await sha1hex12(wsId + SEP + rel)}`
    await supabase.from('projects').upsert({ id: prId, workspace_id: wsId, title: title || rel })

    const { data: existing } = await supabase.from('tasks').select('id,status,completed_at').eq('project_id', prId)
    const exMap = new Map((existing ?? []).map((t: { id: string; status: string; completed_at: string | null }) => [t.id, t]))

    const seen = new Map<string, number>()
    const curIds = new Set<string>()
    const rows: Record<string, unknown>[] = []
    for (let i = 0; i < items.length; i++) {
      const it = items[i]
      const key = norm(it.text)
      const occ = (seen.get(key) ?? 0) + 1
      seen.set(key, occ)
      const tid = `t_${await sha1hex12(prId + SEP + key + SEP + occ)}`
      curIds.add(tid)
      const prev = exMap.get(tid)
      const completed = it.done ? (prev && prev.status === 'done' && prev.completed_at ? prev.completed_at : new Date().toISOString()) : null
      rows.push({ id: tid, workspace_id: wsId, project_id: prId, title: it.text, status: it.done ? 'done' : 'todo', position: (i + 1) * GAP, completed_at: completed })
    }
    if (rows.length) await supabase.from('tasks').upsert(rows)
    const stale = [...exMap.keys()].filter(id => !curIds.has(id))
    if (stale.length) await supabase.from('tasks').delete().in('id', stale)

    const d = items.filter(it => it.done).length
    totalItems += items.length
    totalDone += d
    summaries.push([title || rel, d, items.length])
  }

  const ovText = meta.overview ? await readRel(meta.handle, meta.overview) : null
  await writeOverview(wsId, meta.name, ovText, summaries, totalDone, totalItems)

  meta.lastSync = new Date().toISOString()
  await saveFolder(meta)
  await useStore.getState().fetchAll()
  return { done: totalDone, total: totalItems, files: summaries.length }
}

/** 새 폴더 선택 → 메타 생성·저장·초기 동기화. 취소 시 null */
export async function connectFolder(name?: string, checklists?: string[], overview?: string | null): Promise<FolderMeta | null> {
  if (!fsSupported) throw new Error('이 브라우저는 폴더 선택을 지원하지 않습니다(데스크탑 Chrome/Edge 권장).')
  let dir: FileSystemDirectoryHandle
  try {
    dir = await (window as unknown as { showDirectoryPicker: (o?: { mode?: string }) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker({ mode: 'read' })
  } catch {
    return null // 사용자가 취소
  }
  const meta: FolderMeta = {
    id: randId('ws'),
    name: (name && name.trim()) || dir.name,
    handle: dir,
    checklists: checklists?.length ? checklists : ['TODO.md'],
    overview: overview === undefined ? 'README.md' : overview,
    lastSync: null,
  }
  await saveFolder(meta)
  await syncFolder(meta)
  return meta
}
