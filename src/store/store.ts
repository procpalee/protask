import { useEffect, useMemo, useRef } from 'react'
import { create } from 'zustand'
import { customAlphabet } from 'nanoid'
import { supabase } from '../lib/supabase'
import { enqueue, pendingCount } from '../lib/sync'
import { addDays, startOfWeek } from 'date-fns'
import { nextOccurrence, todayStr, toStr } from '../lib/dates'
import { GAP } from '../lib/position'
import type { Bucket, ChecklistItem, Folder, Phase, Project, Section, Task, Workspace } from '../types'
import { paletteColor } from '../types'

const nanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 12)
export const nid = (p: string) => `${p}_${nanoid()}`

/* 체크리스트(서브태스크) 트리 헬퍼 (id로 재귀) — 키보드 내비/단축키용 */
function ckHas(items: ChecklistItem[], id: string): boolean {
  return items.some(c => c.id === id || ckHas(c.children, id))
}
function ckToggle(items: ChecklistItem[], id: string): ChecklistItem[] {
  return items.map(c => ({ ...c, done: c.id === id ? !c.done : c.done, children: ckToggle(c.children, id) }))
}
function ckDelete(items: ChecklistItem[], id: string): ChecklistItem[] {
  return items.filter(c => c.id !== id).map(c => ({ ...c, children: ckDelete(c.children, id) }))
}
/** 렌더 순서(깊이 우선)대로 체크리스트 항목 id 평탄화 — navOrder 확장용 */
export function flattenCk(items: ChecklistItem[]): string[] {
  const out: string[] = []
  for (const c of items) { out.push(c.id); out.push(...flattenCk(c.children)) }
  return out
}

interface Store {
  loaded: boolean
  workspaces: Workspace[]
  folders: Folder[]
  phases: Phase[]
  projects: Project[]
  tasks: Task[]
  sections: Section[]

  /* UI 상태 (전역 상세 팝업 + hover 단축키 대상) */
  detailTaskId: string | null
  hoverTaskId: string | null
  /** 리스트에서 인라인 서브태스크 입력을 띄울 태스크 id (Shift+Enter) */
  addSubFor: string | null
  setAddSubFor: (id: string | null) => void
  openDetail: (id: string | null) => void
  setHoverTask: (id: string | null) => void
  /** 현재 화면의 키보드 내비 대상 순서(flat). 페이지가 등록 */
  navOrder: string[]
  /** 선택 대상의 종류 — task면 상세/완료 등, project면 Enter=프로젝트 이동 */
  navKind: 'task' | 'project'
  setNavOrder: (ids: string[], kind?: 'task' | 'project') => void
  /** 방향키 이동 — hoverTaskId를 navOrder 내에서 dir만큼 이동 */
  moveHover: (dir: 1 | -1) => void
  /** 선택 태스크의 퀵액션 포커스 인덱스(0~5, -1=없음). →/←로 이동, 1~6/Enter로 적용 */
  quickFocus: number
  setQuickFocus: (n: number) => void
  /** 현재 화면의 탭 전환기 (←/→ 로 탭 이동). 셸이 등록 */
  tabNav: { keys: string[]; active: string; set: (k: string) => void } | null
  setTabNav: (t: { keys: string[]; active: string; set: (k: string) => void } | null) => void
  /** 탭 화면에서 Esc로 사이드바에 포커스 — true면 ↑/↓가 사이드바(뷰) 이동 */
  sidebarFocus: boolean
  setSidebarFocus: (v: boolean) => void

  fetchAll: () => Promise<void>

  /* today sections (사용자 정의) */
  addSection: (name: string) => string
  renameSection: (id: string, name: string) => void
  deleteSection: (id: string) => void
  moveSection: (id: string, dir: -1 | 1) => void

  /* workspaces */
  addWorkspace: (name: string) => string
  updateWorkspace: (id: string, patch: Partial<Workspace>) => void
  deleteWorkspace: (id: string) => void

  /* folders (프로젝트 그룹) */
  addFolder: (name: string) => string
  updateFolder: (id: string, patch: Partial<Folder>) => void
  deleteFolder: (id: string) => void

  /* phases */
  addPhase: (workspaceId: string, name: string) => string
  updatePhase: (id: string, patch: Partial<Phase>) => void
  deletePhase: (id: string) => void

  /* projects */
  addProject: (p: { workspace_id: string; phase_id: string | null; title: string; descr?: string }) => string
  updateProject: (id: string, patch: Partial<Project>) => void
  deleteProject: (id: string) => void
  /** 프로젝트 리스트 리밸런스: ids 순서대로 position 재배치 */
  reorderProjects: (ids: string[]) => void

  /* tasks */
  addTask: (t: Partial<Task> & { title: string }) => string
  updateTask: (id: string, patch: Partial<Task>) => void
  deleteTask: (id: string) => void
  toggleDone: (id: string) => void
  /** 마지막 태스크 변경 취소. 취소한 작업 설명 또는 null */
  undo: () => string | null
  /** 칸반/Today 리스트 리밸런스: ids 순서대로 position 컬럼 재배치 */
  rebalance: (ids: string[], field: 'position' | 'today_position') => void
  /** 서브태스크(체크리스트 항목) 완료 토글 — 소속 태스크를 찾아 적용 (키보드 Space) */
  toggleChecklistItem: (itemId: string) => void
  /** 서브태스크 삭제 — 소속 태스크를 찾아 적용 (키보드 Delete) */
  deleteChecklistItem: (itemId: string) => void
}

const nowISO = () => new Date().toISOString()

function maxPos(list: { position: number }[]): number {
  return list.length ? Math.max(...list.map(x => x.position)) : 0
}

/* ───── Undo (태스크 변경 한정, Ctrl+Z) ───── */
type UndoEntry =
  | { kind: 'update'; id: string; title: string; prev: Partial<Task> }
  | { kind: 'add'; id: string; title: string }
  | { kind: 'delete'; row: Task }
const undoStack: UndoEntry[] = []
let suppressUndo = false
function pushUndo(e: UndoEntry) {
  if (suppressUndo) return
  undoStack.push(e)
  if (undoStack.length > 50) undoStack.shift()
}

export const useStore = create<Store>((set, get) => ({
  loaded: false,
  workspaces: [],
  folders: [],
  phases: [],
  projects: [],
  tasks: [],
  sections: [],

  detailTaskId: null,
  hoverTaskId: null,
  navOrder: [],
  navKind: 'task',
  quickFocus: -1,
  addSubFor: null,
  setAddSubFor: id => set({ addSubFor: id }),
  openDetail: id => set({ detailTaskId: id, hoverTaskId: null, quickFocus: -1, addSubFor: null }),
  setHoverTask: id => set({ hoverTaskId: id, quickFocus: -1, addSubFor: null }),
  setQuickFocus: n => set({ quickFocus: n }),
  setNavOrder: (ids, kind = 'task') => set({ navOrder: ids, navKind: kind }),
  tabNav: null,
  setTabNav: t => set({ tabNav: t }),
  sidebarFocus: false,
  setSidebarFocus: v => set({ sidebarFocus: v }),
  moveHover: dir => {
    const { navOrder, hoverTaskId } = get()
    if (!navOrder.length) return
    const i = hoverTaskId ? navOrder.indexOf(hoverTaskId) : -1
    let next: number
    if (i === -1) next = dir === 1 ? 0 : navOrder.length - 1
    else next = Math.min(navOrder.length - 1, Math.max(0, i + dir))
    set({ hoverTaskId: navOrder[next], quickFocus: -1 })
  },

  fetchAll: async () => {
    // 이미 로드된 뒤의 refetch만 가드: outbox에 미전송 변경이 있으면 낙관적 상태를 덮으므로 건너뜀.
    // 최초 부팅은 스토어가 비어 있어 덮어쓸 게 없으므로, 보류 op가 막혀 있어도 반드시 진행해야 한다
    // (안 그러면 실패가 반복되는 op 하나가 앱 부팅을 영구히 막아 "불러오는 중…"에서 멈춘다).
    if (get().loaded && pendingCount() > 0) return
    const cutoff = new Date(Date.now() - 30 * 86400_000).toISOString()
    const [ws, ph, pr, tk, sc, fd] = await Promise.all([
      supabase.from('workspaces').select('*').order('position'),
      supabase.from('phases').select('*').order('position'),
      supabase.from('projects').select('*').order('position'),
      supabase.from('tasks').select('*').or(`completed_at.is.null,completed_at.gte.${cutoff}`),
      supabase.from('today_sections').select('*').order('position'),
      supabase.from('folders').select('*').order('position'),
    ])
    if (ws.error || ph.error || pr.error || tk.error) return
    set({
      workspaces: (ws.data ?? []) as Workspace[],
      phases: (ph.data ?? []) as Phase[],
      projects: (pr.data ?? []) as Project[],
      tasks: (tk.data ?? []) as Task[],
      sections: (sc.error ? [] : (sc.data ?? [])) as Section[], // 테이블 미생성 시에도 부팅
      folders: (fd.error ? [] : (fd.data ?? [])) as Folder[],
      loaded: true,
    })
  },

  /* ───── today sections ───── */
  addSection: name => {
    const id = nid('sec')
    const row: Section = { id, name, position: maxPos(get().sections) + GAP }
    set(s => ({ sections: [...s.sections, row] }))
    enqueue({ table: 'today_sections', kind: 'upsert', rowId: id, payload: row })
    return id
  },
  renameSection: (id, name) => {
    set(s => ({ sections: s.sections.map(x => (x.id === id ? { ...x, name } : x)) }))
    enqueue({ table: 'today_sections', kind: 'update', rowId: id, payload: { name } })
  },
  deleteSection: id => {
    // 이 섹션에 배정된 태스크는 미지정으로
    const affected = get().tasks.filter(t => t.today_section === id)
    set(s => ({
      sections: s.sections.filter(x => x.id !== id),
      tasks: s.tasks.map(t => (t.today_section === id ? { ...t, today_section: null, today_position: null } : t)),
    }))
    for (const t of affected)
      enqueue({ table: 'tasks', kind: 'update', rowId: t.id, payload: { today_section: null, today_position: null } })
    enqueue({ table: 'today_sections', kind: 'delete', rowId: id })
  },
  moveSection: (id, dir) => {
    const list = [...get().sections].sort((a, b) => a.position - b.position)
    const idx = list.findIndex(x => x.id === id)
    const other = list[idx + dir]
    if (!other) return
    const cur = list[idx]
    set(s => ({
      sections: s.sections.map(x =>
        x.id === cur.id ? { ...x, position: other.position } : x.id === other.id ? { ...x, position: cur.position } : x,
      ),
    }))
    enqueue({ table: 'today_sections', kind: 'update', rowId: cur.id, payload: { position: other.position } })
    enqueue({ table: 'today_sections', kind: 'update', rowId: other.id, payload: { position: cur.position } })
  },

  /* ───── workspaces ───── */
  addWorkspace: name => {
    const id = nid('ws')
    const row: Workspace = { id, name, color: paletteColor(get().workspaces.length), position: maxPos(get().workspaces) + GAP, archived: false, folder_id: null }
    set(s => ({ workspaces: [...s.workspaces, row] }))
    enqueue({ table: 'workspaces', kind: 'upsert', rowId: id, payload: row })
    return id
  },
  updateWorkspace: (id, patch) => {
    set(s => ({ workspaces: s.workspaces.map(w => (w.id === id ? { ...w, ...patch } : w)) }))
    enqueue({ table: 'workspaces', kind: 'update', rowId: id, payload: patch })
  },
  deleteWorkspace: id => {
    set(s => ({
      workspaces: s.workspaces.filter(w => w.id !== id),
      phases: s.phases.filter(p => p.workspace_id !== id),
      projects: s.projects.filter(p => p.workspace_id !== id),
      tasks: s.tasks.filter(t => t.workspace_id !== id),
    }))
    enqueue({ table: 'workspaces', kind: 'delete', rowId: id })
  },

  /* ───── folders (프로젝트 그룹) ───── */
  addFolder: name => {
    const id = nid('fd')
    const row: Folder = { id, name, position: maxPos(get().folders) + GAP }
    set(s => ({ folders: [...s.folders, row] }))
    enqueue({ table: 'folders', kind: 'upsert', rowId: id, payload: row })
    return id
  },
  updateFolder: (id, patch) => {
    set(s => ({ folders: s.folders.map(f => (f.id === id ? { ...f, ...patch } : f)) }))
    enqueue({ table: 'folders', kind: 'update', rowId: id, payload: patch })
  },
  deleteFolder: id => {
    // 폴더 삭제 시 소속 프로젝트는 폴더 없음으로(DB ON DELETE SET NULL 미러)
    set(s => ({
      folders: s.folders.filter(f => f.id !== id),
      workspaces: s.workspaces.map(w => (w.folder_id === id ? { ...w, folder_id: null } : w)),
    }))
    enqueue({ table: 'folders', kind: 'delete', rowId: id })
  },

  /* ───── phases ───── */
  addPhase: (workspaceId, name) => {
    const id = nid('ph')
    const siblings = get().phases.filter(p => p.workspace_id === workspaceId)
    const row: Phase = { id, workspace_id: workspaceId, name, color: null, position: maxPos(siblings) + GAP }
    set(s => ({ phases: [...s.phases, row] }))
    enqueue({ table: 'phases', kind: 'upsert', rowId: id, payload: row })
    return id
  },
  updatePhase: (id, patch) => {
    set(s => ({ phases: s.phases.map(p => (p.id === id ? { ...p, ...patch } : p)) }))
    enqueue({ table: 'phases', kind: 'update', rowId: id, payload: patch })
  },
  deletePhase: id => {
    // projects.phase_id는 DB가 SET NULL — 로컬도 동일하게
    set(s => ({
      phases: s.phases.filter(p => p.id !== id),
      projects: s.projects.map(p => (p.phase_id === id ? { ...p, phase_id: null } : p)),
    }))
    enqueue({ table: 'phases', kind: 'delete', rowId: id })
  },

  /* ───── projects ───── */
  addProject: ({ workspace_id, phase_id, title, descr = '' }) => {
    const id = nid('pr')
    const siblings = get().projects.filter(p => p.workspace_id === workspace_id && p.phase_id === phase_id)
    const row: Project = { id, workspace_id, phase_id, title, descr, status: 'active', position: maxPos(siblings) + GAP }
    set(s => ({ projects: [...s.projects, row] }))
    enqueue({ table: 'projects', kind: 'upsert', rowId: id, payload: row })
    return id
  },
  updateProject: (id, patch) => {
    set(s => ({ projects: s.projects.map(p => (p.id === id ? { ...p, ...patch } : p)) }))
    enqueue({ table: 'projects', kind: 'update', rowId: id, payload: patch })
  },
  deleteProject: id => {
    set(s => ({
      projects: s.projects.filter(p => p.id !== id),
      tasks: s.tasks.filter(t => t.project_id !== id), // DB CASCADE 미러
    }))
    enqueue({ table: 'projects', kind: 'delete', rowId: id })
  },
  reorderProjects: ids => {
    const updates = ids.map((id, i) => ({ id, pos: (i + 1) * GAP }))
    set(s => ({
      projects: s.projects.map(p => {
        const u = updates.find(x => x.id === p.id)
        return u ? { ...p, position: u.pos } : p
      }),
    }))
    for (const u of updates) enqueue({ table: 'projects', kind: 'update', rowId: u.id, payload: { position: u.pos } })
  },

  /* ───── tasks ───── */
  addTask: t => {
    const id = nid('t')
    const siblings = get().tasks.filter(
      x => x.project_id === (t.project_id ?? null) && x.status === (t.status ?? 'todo'),
    )
    const row: Task = {
      id,
      workspace_id: t.workspace_id ?? null,
      project_id: t.project_id ?? null,
      title: t.title,
      notes: t.notes ?? '',
      status: t.status ?? 'todo',
      someday: t.someday ?? false,
      important: t.important ?? false,
      position: maxPos(siblings) + GAP,
      scheduled_date: t.scheduled_date ?? null,
      deadline: t.deadline ?? null,
      today_section: t.today_section ?? null,
      today_position: t.today_position ?? null,
      checklist: t.checklist ?? [],
      recurrence: t.recurrence ?? null,
      created_at: nowISO(),
      updated_at: nowISO(),
      completed_at: null,
    }
    set(s => ({ tasks: [...s.tasks, row] }))
    const { updated_at: _u, ...payload } = row
    enqueue({ table: 'tasks', kind: 'upsert', rowId: id, payload })
    pushUndo({ kind: 'add', id, title: row.title })
    return id
  },

  updateTask: (id, patch) => {
    const prev = get().tasks.find(t => t.id === id)
    if (!prev) return
    const p: Partial<Task> = { ...patch }
    // 규칙: scheduled_date 변경 시 섹션 초기화 (패치가 섹션을 명시하면 존중)
    if ('scheduled_date' in p && p.scheduled_date !== prev.scheduled_date && !('today_section' in patch)) {
      p.today_section = null
      p.today_position = null
    }
    // 일관성: 날짜 부여 → Someday 해제 / Someday 지정 → 날짜·섹션 제거
    if (p.scheduled_date && !('someday' in patch)) p.someday = false
    if (p.someday === true && !('scheduled_date' in patch)) {
      p.scheduled_date = null
      p.today_section = null
      p.today_position = null
    }
    const prevVals: Partial<Task> = {}
    for (const k of Object.keys(p) as (keyof Task)[]) (prevVals as Record<string, unknown>)[k] = prev[k]
    pushUndo({ kind: 'update', id, title: prev.title, prev: prevVals })
    set(s => ({ tasks: s.tasks.map(t => (t.id === id ? { ...t, ...p } : t)) }))
    enqueue({ table: 'tasks', kind: 'update', rowId: id, payload: p })
  },

  deleteTask: id => {
    const row = get().tasks.find(t => t.id === id)
    if (row) pushUndo({ kind: 'delete', row })
    set(s => ({ tasks: s.tasks.filter(t => t.id !== id) }))
    enqueue({ table: 'tasks', kind: 'delete', rowId: id })
  },

  undo: () => {
    const e = undoStack.pop()
    if (!e) return null
    suppressUndo = true
    try {
      if (e.kind === 'update') {
        get().updateTask(e.id, e.prev)
        return `수정 취소: ${e.title}`
      }
      if (e.kind === 'add') {
        get().deleteTask(e.id)
        return `추가 취소: ${e.title}`
      }
      // delete 복원
      const { updated_at: _u, ...payload } = e.row
      set(s => ({ tasks: [...s.tasks, e.row] }))
      enqueue({ table: 'tasks', kind: 'upsert', rowId: e.row.id, payload })
      return `삭제 복원: ${e.row.title}`
    } finally {
      suppressUndo = false
    }
  },

  toggleDone: id => {
    const t = get().tasks.find(x => x.id === id)
    if (!t) return
    if (t.status === 'done') {
      get().updateTask(id, { status: 'todo', completed_at: null })
      return
    }
    get().updateTask(id, { status: 'done', completed_at: nowISO() })
    // 반복 태스크: 완료 시 다음 날짜로 클론
    if (t.recurrence && t.scheduled_date) {
      get().addTask({
        title: t.title,
        notes: t.notes,
        workspace_id: t.workspace_id,
        project_id: t.project_id,
        status: 'todo',
        scheduled_date: nextOccurrence(t.scheduled_date < todayStr() ? todayStr() : t.scheduled_date, t.recurrence),
        deadline: null,
        checklist: t.checklist.map(c => resetCk(c)),
        recurrence: t.recurrence,
      })
    }
  },

  rebalance: (ids, field) => {
    const updates = ids.map((id, i) => ({ id, pos: (i + 1) * GAP }))
    set(s => ({
      tasks: s.tasks.map(t => {
        const u = updates.find(x => x.id === t.id)
        return u ? { ...t, [field]: u.pos } : t
      }),
    }))
    for (const u of updates) enqueue({ table: 'tasks', kind: 'update', rowId: u.id, payload: { [field]: u.pos } })
  },
  toggleChecklistItem: itemId => {
    const owner = get().tasks.find(t => ckHas(t.checklist, itemId))
    if (owner) get().updateTask(owner.id, { checklist: ckToggle(owner.checklist, itemId) })
  },
  deleteChecklistItem: itemId => {
    const owner = get().tasks.find(t => ckHas(t.checklist, itemId))
    if (owner) get().updateTask(owner.id, { checklist: ckDelete(owner.checklist, itemId) })
  },
}))

function resetCk(c: ChecklistItem): ChecklistItem {
  return { id: nid('ck'), title: c.title, done: false, children: c.children.map(resetCk) }
}

/* ───── 파생 버킷 (= GTD 상태의 투영) ───── */
export function bucketOf(t: Task, today = todayStr()): Bucket {
  if (t.status === 'done') return 'done'
  if (t.someday) return 'someday'
  if (!t.scheduled_date) return 'inbox'
  if (t.scheduled_date <= today) return 'today' // 오늘·연체 포함
  return 'scheduled'
}

/** 버킷으로 이동시킬 때 적용할 패치 */
export function bucketPatch(b: Bucket): Partial<Task> {
  switch (b) {
    case 'inbox':
      return { status: 'todo', someday: false, scheduled_date: null, today_section: null, today_position: null, completed_at: null }
    case 'today':
      return { status: 'todo', someday: false, scheduled_date: todayStr(), completed_at: null }
    case 'scheduled':
      return { status: 'todo', someday: false, scheduled_date: toStr(addDays(new Date(), 1)), completed_at: null } // 기본 내일
    case 'someday':
      return { status: 'todo', someday: true, scheduled_date: null, today_section: null, today_position: null, completed_at: null }
    case 'done':
      return { status: 'done', completed_at: nowISO() }
  }
}

/* ───── 파생 셀렉터 ───── */
/** Inbox = 미분류(날짜 X · Someday X · 미완료). 프로젝트는 태그일 뿐 — 배정해도 남는다. */
export const selInbox = (s: Store) =>
  s.tasks.filter(t => !t.scheduled_date && !t.someday && t.status !== 'done')
    .sort((a, b) => b.created_at.localeCompare(a.created_at))

/** Someday = 언젠가 하기로 미뤄둔 것 (칸반 백로그와 동일 집합) */
export const selSomeday = (s: Store) =>
  s.tasks.filter(t => t.someday && t.status !== 'done')
    .sort((a, b) => b.created_at.localeCompare(a.created_at))

export const selToday = (s: Store) => {
  const today = todayStr()
  return s.tasks.filter(t => t.scheduled_date === today)
}

export const selOverdue = (s: Store) => {
  const today = todayStr()
  return s.tasks.filter(t => t.scheduled_date && t.scheduled_date < today && t.status !== 'done')
    .sort((a, b) => (a.scheduled_date ?? '').localeCompare(b.scheduled_date ?? ''))
}

export const selScheduled = (s: Store) => {
  const today = todayStr()
  return s.tasks.filter(t => t.scheduled_date && t.scheduled_date > today && t.status !== 'done')
    .sort((a, b) => (a.scheduled_date ?? '').localeCompare(b.scheduled_date ?? '') || a.position - b.position)
}

/** This Week = 이번주(월~일) 요일에 배정된 미완료 (주간 보드의 요일 칸 집합, 현재 주 기준) */
export const selWeek = (s: Store) => {
  const start = toStr(startOfWeek(new Date(), { weekStartsOn: 1 }))
  const end = toStr(addDays(startOfWeek(new Date(), { weekStartsOn: 1 }), 6))
  return s.tasks.filter(t => t.status !== 'done' && !t.someday && t.scheduled_date && t.scheduled_date >= start && t.scheduled_date <= end)
}

/** Upcoming = 날짜 있는 미완료(지연·오늘·미래 전부). 페이지에서 버킷으로 분류 */
export const selDated = (s: Store) =>
  s.tasks.filter(t => t.scheduled_date && t.status !== 'done')
    .sort((a, b) => (a.scheduled_date ?? '').localeCompare(b.scheduled_date ?? '') || a.position - b.position)

/** 프로젝트 진행률 (hold 제외) */
export function projectStats(s: Store, projectId: string): { done: number; total: number; pct: number } {
  const list = s.tasks.filter(t => t.project_id === projectId && !t.someday) /* 백로그(Someday)는 진행률 제외 */
  const done = list.filter(t => t.status === 'done').length
  return { done, total: list.length, pct: list.length ? Math.round((done / list.length) * 100) : 0 }
}

/** 페이지가 키보드 내비 순서를 등록 — 언마운트 시 정리. kind=task|project.
 *  task 모드에선 각 태스크 뒤에 그 서브태스크(체크리스트) id를 화면 순서대로 끼워, 방향키로 서브태스크도 선택되게 한다. */
export function useNavOrder(ids: string[], kind: 'task' | 'project' = 'task'): void {
  const setNavOrder = useStore(s => s.setNavOrder)
  const tasks = useStore(s => s.tasks)
  const expanded = useMemo(() => {
    if (kind !== 'task') return ids
    const byId = new Map(tasks.map(t => [t.id, t]))
    const out: string[] = []
    for (const id of ids) {
      out.push(id)
      const t = byId.get(id)
      if (t && t.checklist.length) out.push(...flattenCk(t.checklist))
    }
    return out
  }, [ids, tasks, kind])
  const key = kind + '|' + expanded.join(',')
  useEffect(() => {
    setNavOrder(expanded, kind)
    return () => {
      useStore.getState().setNavOrder([])
      useStore.getState().setHoverTask(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
}

/** 페이지가 탭 전환기를 등록 — ←/→ 로 탭 이동(Shortcuts가 사용). 언마운트 시 정리 */
export function useViewTabs(keys: string[], active: string, set: (k: string) => void): void {
  const setRef = useRef(set)
  useEffect(() => { setRef.current = set }) // 렌더 중 ref 변경 금지 → 매 렌더 후 최신 콜백 보관
  const setTabNav = useStore(s => s.setTabNav)
  const keysKey = keys.join('|')
  useEffect(() => {
    setTabNav({ keys, active, set: k => setRef.current(k) })
    useStore.getState().setSidebarFocus(false)
    return () => useStore.getState().setTabNav(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keysKey, active])
}

/** 워크스페이스 식별 색에서 파생한 프로젝트 색 (ws 내 인덱스 기반 팔레트) */
export function projectColor(projectId: string | null, projects: Project[]): string {
  if (!projectId) return '#71717a'
  const p = projects.find(x => x.id === projectId)
  if (!p) return '#71717a'
  const siblings = projects.filter(x => x.workspace_id === p.workspace_id).sort((a, b) => a.position - b.position)
  return paletteColor(siblings.findIndex(x => x.id === projectId))
}

/** done 컬럼 7일 자동 숨김 필터 */
export function visibleDone(t: Task): boolean {
  if (t.status !== 'done' || !t.completed_at) return true
  return Date.now() - new Date(t.completed_at).getTime() < 7 * 86400_000
}
