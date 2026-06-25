import { useMemo, useState } from 'react'
import { Plus, CalendarDays, Folder, ChevronDown, ChevronRight, CloudMoon } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useStore, selInbox, selSomeday, useNavOrder } from '../store/store'
import { parseQuick, daysFromToday, fmtDateShort } from '../lib/dates'
import type { Task } from '../types'
import TaskRow from '../components/TaskRow'

/** 인식된 실행일을 짧은 라벨로 (오늘/내일/모레/M·d) */
function dateLabel(d: string): string {
  const n = daysFromToday(d)
  return n === 0 ? '오늘' : n === 1 ? '내일' : n === 2 ? '모레' : fmtDateShort(d)
}

export default function InboxPage() {
  const inbox = useStore(useShallow(selInbox))
  const someday = useStore(useShallow(selSomeday))
  const workspaces = useStore(s => s.workspaces)
  const addTask = useStore(s => s.addTask)
  const openDetail = useStore(s => s.openDetail)
  const [text, setText] = useState('')
  const [showSomeday, setShowSomeday] = useState(() => localStorage.getItem('pd-inbox-someday') === '1')
  const toggleSomeday = () => setShowSomeday(o => { localStorage.setItem('pd-inbox-someday', o ? '0' : '1'); return !o })

  const parsed = parseQuick(text)
  const submit = () => {
    if (!parsed.title) return
    addTask({ title: parsed.title, scheduled_date: parsed.date })
    setText('')
  }

  // 워크스페이스 단위로 그룹 (프로젝트는 행의 태그로만 표시). 미분류(워크스페이스 없음) 먼저.
  const { noWs, groups } = useMemo(() => {
    const noWs = inbox.filter(t => !t.workspace_id)
    const byWs = new Map<string, Task[]>()
    for (const t of inbox) {
      if (!t.workspace_id) continue
      if (!byWs.has(t.workspace_id)) byWs.set(t.workspace_id, [])
      byWs.get(t.workspace_id)!.push(t)
    }
    const groups = workspaces
      .filter(w => byWs.has(w.id))
      .map(w => ({ ws: w, tasks: byWs.get(w.id)! }))
    return { noWs, groups }
  }, [inbox, workspaces])

  // 키보드 내비 순서 (화면 표시 순서 그대로 flat) — Someday는 펼쳤을 때만
  useNavOrder(useMemo(
    () => [...noWs, ...groups.flatMap(g => g.tasks), ...(showSomeday ? someday : [])].map(t => t.id),
    [noWs, groups, showSomeday, someday],
  ))

  return (
    <div className="mx-auto max-w-[760px] px-5 py-5">
      <div className="mb-4 flex items-baseline gap-3">
        <h1 className="text-[19px] font-bold tracking-tight">Inbox</h1>
        <span className="text-[13.5px] font-medium text-zinc-400">{inbox.length}건</span>
      </div>

      {/* 빠른 입력 — 모바일에선 + 버튼(전역 캡처)으로 대체되므로 숨김 */}
      <div className="mb-4 hidden items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-1 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20 md:flex dark:border-zinc-700 dark:bg-zinc-900">
        <Plus size={15} className="shrink-0 text-zinc-400" />
        <input
          data-capture
          className="h-9 flex-1 bg-transparent text-[14.5px] outline-none placeholder:text-zinc-400"
          placeholder="생각나는 것을 바로 입력 — Enter"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && submit()}
        />
        {parsed.date && (
          <span
            className="flex shrink-0 items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[12px] font-semibold text-blue-600 dark:bg-blue-950/50 dark:text-blue-400"
            title={`인식된 실행일: ${parsed.date}`}
          >
            <CalendarDays size={12} />
            {dateLabel(parsed.date)}
          </span>
        )}
      </div>

      {noWs.length > 0 && (
        <section className="mb-4">
          {groups.length > 0 && <GroupHead label="미분류" count={noWs.length} />}
          {noWs.map(t => <TaskRow key={t.id} task={t} onOpen={openDetail} />)}
        </section>
      )}

      {groups.map(({ ws, tasks }) => (
        <section key={ws.id} className="mb-4">
          <GroupHead label={ws.name} count={tasks.length} />
          {tasks.map(t => <TaskRow key={t.id} task={t} onOpen={openDetail} />)}
        </section>
      ))}

      {inbox.length === 0 && (
        <div className="rounded-lg border border-dashed border-zinc-300 p-10 text-center text-[14px] text-zinc-400 dark:border-zinc-700">
          Inbox가 비었습니다 ✓
        </div>
      )}

      {/* Someday — Inbox 아래에 펼침형 섹션 */}
      {someday.length > 0 && (
        <section className="mt-6 border-t border-zinc-200 pt-3 dark:border-zinc-800">
          <button className="mb-0.5 flex w-full items-center gap-1.5 px-1.5 py-1 text-left" onClick={toggleSomeday}>
            {showSomeday ? <ChevronDown size={15} className="text-zinc-400" /> : <ChevronRight size={15} className="text-zinc-400" />}
            <CloudMoon size={14} className="text-zinc-400" />
            <span className="text-[14px] font-bold">Someday</span>
            <span className="text-[12.5px] font-semibold text-zinc-400">{someday.length}</span>
          </button>
          {showSomeday && someday.map(t => <TaskRow key={t.id} task={t} onOpen={openDetail} />)}
        </section>
      )}
    </div>
  )
}

function GroupHead({ label, count }: { label: string; count: number }) {
  return (
    <div className="mb-0.5 flex items-baseline gap-1.5 px-1.5">
      <Folder size={12} className="shrink-0 self-center text-zinc-400" />
      <span className="text-[13px] font-bold">{label}</span>
      <span className="text-[12px] font-semibold text-zinc-400">{count}</span>
    </div>
  )
}
