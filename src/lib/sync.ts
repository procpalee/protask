import { supabase } from './supabase'

/**
 * Outbox 동기화 레이어 (realtime 없음 — 1인용).
 * 낙관적 스토어 변경 후 변경 컬럼만 행 단위 PATCH를 직렬 flush.
 * 큐는 localStorage에 영속 — 오프라인/새로고침에도 유실 없음.
 */

type Table = 'workspaces' | 'workspace_canvas' | 'phases' | 'projects' | 'tasks' | 'today_sections' | 'folders'

export interface Op {
  table: Table
  kind: 'upsert' | 'update' | 'delete'
  rowId: string
  payload?: object
}

export type SyncStatus = 'idle' | 'saving' | 'offline' | 'error'

const LS_KEY = 'pd-outbox-v1'
let queue: Op[] = loadQueue()
let flushing = false
let inFlight: Op | null = null
let retryTimer: ReturnType<typeof setTimeout> | null = null
let failStreak = 0
/** 마지막으로 실패한 동기화 op과 에러 — 디버깅용(콘솔 window.__pdSyncError). */
export let lastSyncError: { table: string; kind: string; rowId: string; error: unknown } | null = null
const listeners = new Set<(s: SyncStatus, pending: number) => void>()

function loadQueue(): Op[] {
  try {
    const raw = localStorage.getItem(LS_KEY)
    return raw ? (JSON.parse(raw) as Op[]) : []
  } catch {
    return []
  }
}
function saveQueue() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(queue))
  } catch { /* quota — 무시 */ }
}

export function onSyncStatus(fn: (s: SyncStatus, pending: number) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
function notify(s: SyncStatus) {
  listeners.forEach(fn => fn(s, queue.length))
}

const idCol = (table: Table) => (table === 'workspace_canvas' ? 'workspace_id' : 'id')

export function enqueue(op: Op) {
  if (op.kind === 'delete') {
    // 같은 행의 보류 중인 쓰기는 무의미 — 제거 후 delete 추가 (in-flight 제외)
    queue = queue.filter(q => !(q.table === op.table && q.rowId === op.rowId && q !== inFlight))
    queue.push(op)
  } else if (op.kind === 'update') {
    // 같은 행의 마지막 보류 op에 병합 (in-flight 제외)
    const last = queue[queue.length - 1]
    if (last && last !== inFlight && last.table === op.table && last.rowId === op.rowId && last.kind !== 'delete') {
      last.payload = { ...last.payload, ...op.payload }
    } else {
      queue.push(op)
    }
  } else {
    queue.push(op)
  }
  saveQueue()
  void flush()
}

async function exec(op: Op) {
  const col = idCol(op.table)
  if (op.kind === 'upsert') {
    const { error } = await supabase.from(op.table).upsert(op.payload as never)
    if (error) throw error
  } else if (op.kind === 'update') {
    const { error } = await supabase.from(op.table).update(op.payload as never).eq(col, op.rowId)
    if (error) throw error
  } else {
    const { error } = await supabase.from(op.table).delete().eq(col, op.rowId)
    if (error) throw error
  }
}

export async function flush(): Promise<void> {
  if (flushing) return
  flushing = true
  notify(queue.length ? 'saving' : 'idle')
  while (queue.length) {
    const op = queue[0]
    inFlight = op
    let ok = false
    let lastErr: unknown = null
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      try {
        await exec(op)
        ok = true
      } catch (e) {
        lastErr = e
        if (!navigator.onLine) break
        await new Promise(r => setTimeout(r, 400 * (attempt + 1)))
      }
    }
    inFlight = null
    if (ok) {
      queue.shift()
      saveQueue()
      failStreak = 0
    } else {
      // 실패 원인을 표면화(이전엔 조용히 삼켜 디버깅 불가). 콘솔 + 보관.
      lastSyncError = { table: op.table, kind: op.kind, rowId: op.rowId, error: lastErr }
      const se = lastErr as { status?: number; code?: string; message?: string } | null
      console.warn(`[sync] 저장 실패 — ${op.table}/${op.kind} ${op.rowId}`, se?.status ?? '', se?.code ?? '', se?.message ?? lastErr)

      // 재시도로 절대 성공할 수 없는 구조적/데이터 오류(FK·not-null·check·잘못된 입력)는 폐기하고
      // 큐를 계속 진행한다. 안 그러면 이런 poison op 하나가 큐 맨 앞에서 모든 저장을 영구히 막는다.
      // (인증/RLS·네트워크 오류는 폐기하지 않음 — 재로그인/온라인 복귀로 복구 가능하므로 아래 백오프로.)
      const UNDELIVERABLE = new Set(['23503', '23502', '23514', '22P02', '22001'])
      if (navigator.onLine && se?.code && UNDELIVERABLE.has(se.code)) {
        console.warn(`[sync] 전송 불가 op 폐기(${se.code}) → 큐 진행: ${op.table}/${op.kind} ${op.rowId}`)
        queue.shift()
        saveQueue()
        failStreak = 0
        continue
      }
      // 보존 + 나중 재시도. 실패 시 refetch 금지(로컬 의도 보존).
      flushing = false
      notify(navigator.onLine ? 'error' : 'offline')
      // 지수 백오프(30초→…→최대 5분). 영구 실패 op(예: 세션 만료 401)이 서버를 난타하지 않게.
      // 진짜 복구는 이벤트로 즉시 일어난다: online / 재로그인(authStore에서 flush) / 새 enqueue / 동기화점 클릭.
      failStreak = Math.min(failStreak + 1, 6)
      const delay = Math.min(30_000 * 2 ** (failStreak - 1), 5 * 60_000)
      if (retryTimer) clearTimeout(retryTimer)
      retryTimer = setTimeout(() => void flush(), delay)
      return
    }
  }
  flushing = false
  failStreak = 0
  notify('idle')
}

export function pendingCount(): number {
  return queue.length
}

/** 멈춘 큐를 즉시 재시도 (재로그인·온라인 복귀·동기화점 클릭 시). 백오프 타이머·실패 카운트 리셋. */
export function retryNow(): void {
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null }
  failStreak = 0
  void flush()
}

window.addEventListener('online', () => retryNow())
// 디버깅: 콘솔에서 window.__pdSync() 로 대기 큐·마지막 에러 확인
;(window as unknown as { __pdSync: () => unknown }).__pdSync = () => ({ pending: queue.length, queue, lastError: lastSyncError })
// 부팅 시 잔여 큐 flush
void flush()
