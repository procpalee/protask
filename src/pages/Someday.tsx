import { useMemo, useState } from 'react'
import { useDraggable, useDroppable, type DragEndEvent } from '@dnd-kit/core'
import { Moon, Sun, CalendarDays, Clock3, ListTodo } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { addDays } from 'date-fns'
import { useStore, selSomeday, useNavOrder, usePageDnd } from '../store/store'
import { todayStr, toStr } from '../lib/dates'
import { wsColor, type Task } from '../types'
import TaskRow from '../components/TaskRow'

/** Someday(언젠가) — Inbox와 동일 구성. 날짜 배정 시 Someday에서 빠져나감(칸반 백로그와 동일 집합) */
export default function SomedayPage() {
  const someday = useStore(useShallow(selSomeday))
  const workspaces = useStore(s => s.workspaces)
  const projects = useStore(s => s.projects)
  const sections = useStore(s => s.sections)
  const addTask = useStore(s => s.addTask)
  const updateTask = useStore(s => s.updateTask)
  const openDetail = useStore(s => s.openDetail)
  const [text, setText] = useState('')
  const dragId = useStore(s => s.dragId)
  const dragActive = !!dragId && !dragId.startsWith('P:') && !dragId.startsWith('gcal:')

  const submit = () => {
    const v = text.trim()
    if (!v) return
    addTask({ title: v, someday: true })
    setText('')
  }

  // 워크스페이스 ▸ 프로젝트 2단 그룹. 워크스페이스 없는 항목은 맨 위.
  const { noWs, groups } = useMemo(() => {
    const noWs = someday.filter(t => !t.workspace_id)
    const byWs = new Map<string, Task[]>()
    for (const t of someday) {
      if (!t.workspace_id) continue
      if (!byWs.has(t.workspace_id)) byWs.set(t.workspace_id, [])
      byWs.get(t.workspace_id)!.push(t)
    }
    const groups = workspaces.filter(w => byWs.has(w.id)).map(w => {
      const wsTasks = byWs.get(w.id)!
      const wsProjects = projects.filter(p => p.workspace_id === w.id).sort((a, b) => a.position - b.position)
      const subs = wsProjects
        .map(p => ({ project: p, tasks: wsTasks.filter(t => t.project_id === p.id) }))
        .filter(s => s.tasks.length)
      const noProj = wsTasks.filter(t => !t.project_id || !wsProjects.some(p => p.id === t.project_id))
      return { ws: w, subs, noProj, total: wsTasks.length }
    })
    return { noWs, groups }
  }, [someday, workspaces, projects])

  useNavOrder(useMemo(
    () => [...noWs, ...groups.flatMap(g => [...g.subs.flatMap(s => s.tasks), ...g.noProj])].map(t => t.id),
    [noWs, groups],
  ))

  const sortedSections = useMemo(() => [...sections].sort((a, b) => a.position - b.position), [sections])

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over) return
    const taskId = String(active.id)
    const overId = String(over.id)
    // 날짜 배정 시 store 규칙이 someday를 자동 해제
    if (overId === 'drop:today') updateTask(taskId, { scheduled_date: todayStr() })
    else if (overId === 'drop:tomorrow') updateTask(taskId, { scheduled_date: toStr(addDays(new Date(), 1)) })
    else if (overId === 'drop:nextweek') updateTask(taskId, { scheduled_date: toStr(addDays(new Date(), 7)) })
    else if (overId.startsWith('dropsec:'))
      updateTask(taskId, { scheduled_date: todayStr(), today_section: overId.slice(8) })
  }
  usePageDnd(onDragEnd)

  return (
    <div className="mx-auto max-w-[760px] px-5 py-5">
        <div className="mb-4 flex items-baseline gap-2">
          <Moon size={16} className="self-center text-violet-400" />
          <h1 className="text-[18px] font-bold tracking-tight">Someday</h1>
          <span className="text-[12.5px] font-medium text-zinc-400">{someday.length}건</span>
        </div>

        {/* 드래그 중 나타나는 드롭 존 (날짜 배정 = Someday 해제) */}
        {dragActive && (
          <div className="sticky top-2 z-30 mb-3 flex flex-wrap gap-1.5 rounded-xl border border-blue-200 bg-white/95 p-2 shadow-lg backdrop-blur dark:border-blue-900 dark:bg-zinc-900/95">
            <DropZone id="drop:today" icon={<Sun size={13} />} label="오늘 (Today)" accent />
            <DropZone id="drop:tomorrow" icon={<CalendarDays size={13} />} label="내일" />
            <DropZone id="drop:nextweek" icon={<CalendarDays size={13} />} label="+1주" />
            {sortedSections.map(s => (
              <DropZone key={s.id} id={`dropsec:${s.id}`} icon={<Clock3 size={13} />} label={`오늘 · ${s.name}`} />
            ))}
            {sortedSections.length === 0 && (
              <span className="flex items-center gap-1 px-1 text-[11px] text-zinc-400"><ListTodo size={12} /> Today에서 섹션을 만들면 여기에도 나타납니다</span>
            )}
          </div>
        )}

        <div className="mb-4 flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-1 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20 dark:border-zinc-700 dark:bg-zinc-900">
          <Moon size={15} className="shrink-0 text-zinc-400" />
          <input
            data-capture
            className="h-9 flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-zinc-400"
            placeholder="언젠가 할 일을 입력 — Enter"
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && submit()}
          />
        </div>

        {noWs.length > 0 && (
          <section className="mb-4">
            {groups.length > 0 && <GroupHead label="미분류" color="#71717a" count={noWs.length} />}
            {noWs.map(t => <DraggableRow key={t.id} task={t} onOpen={openDetail} />)}
          </section>
        )}

        {groups.map(({ ws, subs, noProj, total }) => (
          <section key={ws.id} className="mb-4">
            <GroupHead label={ws.name} color={wsColor(ws.id, workspaces)} count={total} />
            {subs.map(s => (
              <div key={s.project.id} className="mb-1.5">
                <SubHead label={s.project.title} count={s.tasks.length} />
                {s.tasks.map(t => <DraggableRow key={t.id} task={t} onOpen={openDetail} />)}
              </div>
            ))}
            {noProj.length > 0 && (
              <div className="mb-1.5">
                {subs.length > 0 && <SubHead label="프로젝트 없음" count={noProj.length} muted />}
                {noProj.map(t => <DraggableRow key={t.id} task={t} onOpen={openDetail} />)}
              </div>
            )}
          </section>
        ))}

        {someday.length === 0 && (
          <div className="rounded-lg border border-dashed border-zinc-300 p-10 text-center text-[13px] text-zinc-400 dark:border-zinc-700">
            보류 중인 태스크가 없습니다
          </div>
        )}
    </div>
  )
}

function DraggableRow({ task, onOpen }: { task: Task; onOpen: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id })
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} className={isDragging ? 'opacity-40' : ''}>
      <TaskRow task={task} onOpen={onOpen} />
    </div>
  )
}

function DropZone({ id, icon, label, accent }: { id: string; icon: React.ReactNode; label: string; accent?: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <div
      ref={setNodeRef}
      className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[12px] font-semibold transition-colors ${
        isOver
          ? 'border-blue-500 bg-blue-500 text-white'
          : accent
            ? 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-300'
            : 'border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800/70 dark:text-zinc-300'
      }`}
    >
      {icon}
      {label}
    </div>
  )
}

function GroupHead({ label, color, count }: { label: string; color: string; count: number }) {
  return (
    <div className="mb-0.5 flex items-baseline gap-1.5 px-1.5">
      <span className="h-2 w-2 shrink-0 self-center rounded-[3px]" style={{ background: color }} />
      <span className="text-[12px] font-bold">{label}</span>
      <span className="text-[11px] font-semibold text-zinc-400">{count}</span>
    </div>
  )
}

/** 워크스페이스 아래 프로젝트 소제목 (들여쓰기) */
function SubHead({ label, count, muted }: { label: string; count: number; muted?: boolean }) {
  return (
    <div className="mt-0.5 mb-0.5 flex items-baseline gap-1.5 pl-4">
      <span className={`text-[11.5px] font-semibold ${muted ? 'text-zinc-400' : 'text-zinc-500 dark:text-zinc-300'}`}>{label}</span>
      <span className="text-[10.5px] font-semibold text-zinc-400">{count}</span>
    </div>
  )
}
