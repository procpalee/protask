import { useMemo, useState } from 'react'
import {
  DndContext, DragOverlay, PointerSensor, TouchSensor,
  useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core'
import { addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameMonth, startOfMonth, startOfWeek } from 'date-fns'
import { ChevronDown, ChevronLeft, ChevronRight, CircleDashed, Moon } from 'lucide-react'
import { useStore, kanbanColOf } from '../../store/store'
import { KANBAN_DOT, type Task } from '../../types'
import { todayStr, toStr } from '../../lib/dates'
import ProjectChip from '../ProjectChip'

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토']

/** 프로젝트 월간 캘린더 — 상위 Calendar와 동일 디자인(시작전/백로그 패널 + 프로젝트 태그) */
export default function ProjectCalendar({ tasks }: { tasks: Task[] }) {
  const updateTask = useStore(s => s.updateTask)
  const openDetail = useStore(s => s.openDetail)
  const [anchor, setAnchor] = useState(() => new Date())
  const [activeId, setActiveId] = useState<string | null>(null)
  const [backlogOpen, setBacklogOpen] = useState(false)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  )

  const days = useMemo(
    () => eachDayOfInterval({ start: startOfWeek(startOfMonth(anchor)), end: endOfWeek(endOfMonth(anchor)) }),
    [anchor],
  )

  const byDate = useMemo(() => {
    const map = new Map<string, Task[]>()
    for (const t of tasks) {
      if (!t.scheduled_date) continue
      if (!map.has(t.scheduled_date)) map.set(t.scheduled_date, [])
      map.get(t.scheduled_date)!.push(t)
    }
    for (const list of map.values()) list.sort((a, b) => a.position - b.position)
    return map
  }, [tasks])

  const todoTasks = useMemo(() => tasks.filter(t => !t.scheduled_date && !t.someday && t.status !== 'done'), [tasks])
  const backlogTasks = useMemo(() => tasks.filter(t => t.someday && t.status !== 'done'), [tasks])

  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null)
    const { active, over } = e
    if (!over) return
    const task = tasks.find(t => t.id === String(active.id))
    if (!task) return
    const overId = String(over.id)
    if (overId.startsWith('day:')) {
      const date = overId.slice(4)
      if (task.scheduled_date !== date) updateTask(task.id, { scheduled_date: date })
    } else if (overId === 'panel:todo') {
      updateTask(task.id, { scheduled_date: null, someday: false })
    } else if (overId === 'panel:backlog') {
      updateTask(task.id, { someday: true })
    }
  }

  const activeTask = activeId ? tasks.find(t => t.id === activeId) : null
  const today = todayStr()

  return (
    <div className="flex h-full flex-col px-5 pb-5">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-[16px] font-bold tracking-tight">{format(anchor, 'yyyy년 M월')}</h2>
        <div className="ml-auto flex items-center gap-1">
          <button className="btn !px-2" onClick={() => setAnchor(m => addMonths(m, -1))} title="이전 달"><ChevronLeft size={14} /></button>
          <button className="btn" onClick={() => setAnchor(new Date())}>오늘</button>
          <button className="btn !px-2" onClick={() => setAnchor(m => addMonths(m, 1))} title="다음 달"><ChevronRight size={14} /></button>
        </div>
      </div>

      <DndContext sensors={sensors} onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))} onDragEnd={onDragEnd}>
        <div className="flex min-h-0 flex-1 gap-3">
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="grid grid-cols-7 border-b border-zinc-200 pb-1 dark:border-zinc-800">
              {WEEKDAY.map((d, i) => (
                <div key={d} className={`px-2 text-[12.5px] font-bold ${i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : 'text-zinc-400'}`}>{d}</div>
              ))}
            </div>
            <div className="grid flex-1 auto-rows-fr grid-cols-7 overflow-y-auto">
              {days.map(d => {
                const ds = toStr(d)
                return <DayCell key={ds} date={d} dateStr={ds} inMonth={isSameMonth(d, anchor)} isToday={ds === today} tasks={byDate.get(ds) ?? []} onOpen={openDetail} />
              })}
            </div>
          </div>

          <SidePanel todo={todoTasks} backlog={backlogTasks} backlogOpen={backlogOpen} onToggleBacklog={() => setBacklogOpen(o => !o)} onOpen={openDetail} />
        </div>

        <DragOverlay>
          {activeTask ? <div className="rounded border border-blue-300 bg-white px-2 py-1 text-[12.5px] shadow-lg dark:border-blue-700 dark:bg-zinc-800">{activeTask.title}</div> : null}
        </DragOverlay>
      </DndContext>
    </div>
  )
}

function DayCell({ date, dateStr, inMonth, isToday, tasks, onOpen }: {
  date: Date; dateStr: string; inMonth: boolean; isToday: boolean; tasks: Task[]; onOpen: (id: string) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${dateStr}` })
  const day = date.getDay()
  const MAX = 4
  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-[92px] flex-col border-r border-b border-zinc-100 p-1 dark:border-zinc-800/70 ${
        !inMonth ? 'bg-zinc-50/60 dark:bg-zinc-900/40' : day === 0 || day === 6 ? 'bg-zinc-50/40 dark:bg-zinc-900/20' : ''
      } ${isOver ? 'bg-blue-50/70 ring-1 ring-blue-400 ring-inset dark:bg-blue-950/30' : ''}`}
    >
      <div className={`mb-0.5 px-1 text-[12.5px] font-semibold ${
        isToday ? 'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-blue-600 px-1 text-white'
          : !inMonth ? 'text-zinc-300 dark:text-zinc-600' : day === 0 ? 'text-red-400' : day === 6 ? 'text-blue-400' : 'text-zinc-500'
      }`}>{date.getDate()}</div>
      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
        {tasks.slice(0, MAX).map(t => <CalChip key={t.id} task={t} onOpen={onOpen} />)}
        {tasks.length > MAX && <div className="px-1 text-[12.5px] font-medium text-zinc-400">+{tasks.length - MAX}개 더</div>}
      </div>
    </div>
  )
}

function CalChip({ task, onOpen }: { task: Task; onOpen: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id })
  const done = task.status === 'done'
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => onOpen(task.id)}
      className={`flex cursor-pointer items-center gap-1 truncate rounded border border-zinc-200 bg-white px-1 py-0.5 text-[13px] hover:border-blue-400 dark:border-zinc-700 dark:bg-zinc-800 dark:hover:border-blue-600 ${
        isDragging ? 'opacity-40' : ''
      } ${done ? 'opacity-50' : ''}`}
      title={task.title}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${KANBAN_DOT[kanbanColOf(task)]}`} />
      <span className={`truncate ${done ? 'line-through' : ''}`}>{task.title}</span>
    </div>
  )
}

/* ───── 사이드 패널 (시작전 + 백로그) — 상위 Calendar와 동일 구조 ───── */
function SidePanel({ todo, backlog, backlogOpen, onToggleBacklog, onOpen }: {
  todo: Task[]; backlog: Task[]; backlogOpen: boolean; onToggleBacklog: () => void; onOpen: (id: string) => void
}) {
  return (
    <aside className="hidden w-[300px] shrink-0 flex-col gap-2 overflow-y-auto md:flex">
      <PanelSection dropId="panel:todo" icon={<CircleDashed size={14} className="text-zinc-400" />} title="시작전" tasks={todo} emptyText="시작전 태스크 없음" onOpen={onOpen} />
      {backlogOpen ? (
        <PanelSection dropId="panel:backlog" icon={<Moon size={14} className="text-violet-400" />} title="백로그" tasks={backlog} emptyText="백로그 비었음" onOpen={onOpen} onCollapse={onToggleBacklog} />
      ) : (
        <button
          onClick={onToggleBacklog}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-200 bg-zinc-50/50 px-3 py-2 hover:border-violet-300 dark:border-zinc-800 dark:bg-zinc-900/40 dark:hover:border-violet-700"
          title="백로그 열기"
        >
          <Moon size={14} className="text-violet-400" />
          <span className="text-[13.5px] font-bold">백로그</span>
          <span className="text-[12px] font-semibold text-zinc-400">{backlog.length}</span>
          <ChevronRight size={14} className="ml-auto text-zinc-400" />
        </button>
      )}
    </aside>
  )
}

function PanelSection({ dropId, icon, title, tasks, emptyText, onOpen, onCollapse }: {
  dropId: string; icon: React.ReactNode; title: string; tasks: Task[]; emptyText: string; onOpen: (id: string) => void; onCollapse?: () => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: dropId })
  return (
    <div
      ref={setNodeRef}
      className={`flex max-h-[55%] shrink-0 flex-col rounded-lg border transition-colors ${
        isOver ? 'border-blue-400 bg-blue-50/50 dark:border-blue-600 dark:bg-blue-950/20' : 'border-zinc-200 bg-zinc-50/50 dark:border-zinc-800 dark:bg-zinc-900/40'
      }`}
    >
      <div className="flex items-center gap-1.5 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        {icon}
        <span className="text-[13.5px] font-bold">{title}</span>
        <span className="text-[12px] font-semibold text-zinc-400">{tasks.length}</span>
        {onCollapse ? (
          <button onClick={onCollapse} className="ml-auto rounded p-0.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200" title="접기"><ChevronDown size={14} /></button>
        ) : (
          <span className="ml-auto text-[11.5px] text-zinc-400">{isOver ? '여기에 놓기' : '드래그'}</span>
        )}
      </div>
      <div className="flex-1 space-y-1 overflow-y-auto p-2">
        {tasks.map(t => <PanelRow key={t.id} task={t} onOpen={onOpen} />)}
        {tasks.length === 0 && <p className="px-1 py-3 text-center text-[13px] text-zinc-400">{emptyText}</p>}
      </div>
    </div>
  )
}

function PanelRow({ task, onOpen }: { task: Task; onOpen: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id })
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => onOpen(task.id)}
      className={`flex cursor-grab items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-[13.5px] hover:border-blue-400 active:cursor-grabbing dark:border-zinc-700 dark:bg-zinc-800 dark:hover:border-blue-600 ${
        isDragging ? 'opacity-40' : ''
      }`}
      title={task.title}
    >
      <span className="min-w-0 flex-1 truncate">{task.title}</span>
      <ProjectChip projectId={task.project_id} workspaceId={task.workspace_id} />
    </div>
  )
}
