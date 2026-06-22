import { useMemo, useState, type ReactNode } from 'react'
import {
  DndContext, DragOverlay, PointerSensor, TouchSensor, closestCorners, pointerWithin,
  useDroppable, useSensor, useSensors, type CollisionDetection, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Check, Plus, ChevronLeft, ChevronRight, Inbox as InboxIcon } from 'lucide-react'
import { startOfWeek, addDays, addWeeks, format } from 'date-fns'
import { ko } from 'date-fns/locale'
import { useStore, useNavOrder } from '../store/store'
import { toStr, todayStr, fmtDateShort } from '../lib/dates'
import { between } from '../lib/position'
import { countCk } from '../lib/group'
import { DeadlineBadge } from '../components/TaskRow'
import type { Task } from '../types'

const BACKLOG = 'backlog'

/** 주간 플래너 보드 — 요일 7칸 + 백로그(미배정·지연). 드래그로 scheduled_date 배정. 데스크탑 전용.
 *  leading: 헤더 좌측에 끼울 노드(예: Today의 오늘/이번주 탭). 없으면 "주간" 제목 표시. */
export default function WeekBoard({ leading }: { leading?: ReactNode }) {
  const tasks = useStore(s => s.tasks)
  const updateTask = useStore(s => s.updateTask)
  const addTask = useStore(s => s.addTask)
  const rebalance = useStore(s => s.rebalance)
  const openDetail = useStore(s => s.openDetail)
  const [weekOffset, setWeekOffset] = useState(0)
  const [activeId, setActiveId] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  )
  const collision: CollisionDetection = useMemo(() => args => {
    const p = pointerWithin(args)
    return p.length ? p : closestCorners(args)
  }, [])

  const today = todayStr()
  const days = useMemo(() => {
    const start = startOfWeek(addWeeks(new Date(), weekOffset), { weekStartsOn: 1 })
    return Array.from({ length: 7 }, (_, i) => {
      const d = addDays(start, i)
      return { key: toStr(d), label: format(d, 'EEE', { locale: ko }), short: fmtDateShort(toStr(d)) }
    })
  }, [weekOffset])
  const weekStart = days[0].key
  const weekEnd = days[6].key

  // 컬럼 데이터: backlog(미배정+이번주 이전 지연) + 요일별
  const { colMap, overdueIds } = useMemo(() => {
    const map: Record<string, Task[]> = { [BACKLOG]: [] }
    for (const d of days) map[d.key] = []
    const overdue: Task[] = []
    const inbox: Task[] = []
    for (const t of tasks) {
      if (t.status === 'done') continue
      if (t.scheduled_date) {
        if (t.scheduled_date >= weekStart && t.scheduled_date <= weekEnd) map[t.scheduled_date]?.push(t)
        else if (t.scheduled_date < weekStart) overdue.push(t) // 이번주 이전 지연
      } else if (!t.someday) {
        inbox.push(t) // 미배정(Inbox)
      }
    }
    for (const d of days) map[d.key].sort((a, b) => a.position - b.position)
    overdue.sort((a, b) => (a.scheduled_date ?? '').localeCompare(b.scheduled_date ?? ''))
    inbox.sort((a, b) => b.created_at.localeCompare(a.created_at))
    map[BACKLOG] = [...overdue, ...inbox]
    return { colMap: map, overdueIds: new Set(overdue.map(t => t.id)) }
  }, [tasks, days, weekStart, weekEnd])

  useNavOrder(useMemo(
    () => [...colMap[BACKLOG], ...days.flatMap(d => colMap[d.key])].map(t => t.id),
    [colMap, days],
  ))

  const colOf = (id: string): string | null => {
    for (const key of Object.keys(colMap)) if (colMap[key].some(t => t.id === id)) return key
    return null
  }

  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null)
    const { active, over } = e
    if (!over) return
    const taskId = String(active.id)
    const fromKey = colOf(taskId)
    if (!fromKey) return
    const overId = String(over.id)

    let targetKey: string
    let ids: string[]
    let insertAt: number
    if (overId === BACKLOG || overId.startsWith('day:')) {
      targetKey = overId === BACKLOG ? BACKLOG : overId.slice(4)
      ids = colMap[targetKey].map(t => t.id).filter(id => id !== taskId)
      insertAt = ids.length
    } else {
      targetKey = colOf(overId) ?? ''
      if (!targetKey) return
      const col = colMap[targetKey]
      const origIdx = col.findIndex(t => t.id === taskId)
      const overIdx = col.findIndex(t => t.id === overId)
      ids = col.map(t => t.id).filter(id => id !== taskId)
      const overPos = ids.indexOf(overId)
      insertAt = origIdx !== -1 && origIdx < overIdx ? overPos + 1 : overPos
    }

    if (fromKey === targetKey) {
      const before = colMap[targetKey].map(t => t.id)
      const after = [...ids.slice(0, insertAt), taskId, ...ids.slice(insertAt)]
      if (before.join() === after.join()) return
    }

    // 컬럼 이동 패치: 요일=그 날짜, 백로그=날짜 해제(Inbox 회수)
    const datePatch: Partial<Task> =
      fromKey === targetKey ? {}
        : targetKey === BACKLOG ? { scheduled_date: null, someday: false }
          : { scheduled_date: targetKey, someday: false }

    const prevPos = ids[insertAt - 1] ? tasks.find(t => t.id === ids[insertAt - 1])?.position : undefined
    const nextPos = ids[insertAt] ? tasks.find(t => t.id === ids[insertAt])?.position : undefined
    const pos = between(prevPos, nextPos)
    if (Number.isNaN(pos)) {
      updateTask(taskId, datePatch)
      rebalance([...ids.slice(0, insertAt), taskId, ...ids.slice(insertAt)], 'position')
    } else {
      updateTask(taskId, { ...datePatch, position: pos })
    }
  }

  const activeTask = activeId ? tasks.find(t => t.id === activeId) : null
  const rangeLabel = `${fmtDateShort(weekStart)} – ${fmtDateShort(weekEnd)}`

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 px-5 pt-5 pb-3">
        {leading ?? <h1 className="text-[19px] font-bold tracking-tight">주간</h1>}
        <span className="text-[13.5px] font-medium text-zinc-400">{rangeLabel}</span>
        <div className="ml-auto flex items-center gap-1">
          <button className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800" onClick={() => setWeekOffset(o => o - 1)} title="이전 주"><ChevronLeft size={16} /></button>
          <button className={`rounded-md px-2 py-1 text-[13px] font-semibold ${weekOffset === 0 ? 'text-zinc-300 dark:text-zinc-600' : 'text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950'}`} onClick={() => setWeekOffset(0)} disabled={weekOffset === 0}>이번주</button>
          <button className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800" onClick={() => setWeekOffset(o => o + 1)} title="다음 주"><ChevronRight size={16} /></button>
        </div>
      </div>

      <DndContext sensors={sensors} collisionDetection={collision} autoScroll={false} onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
        <div className="flex min-h-0 flex-1 gap-3 px-5 pb-5">
          <BacklogColumn tasks={colMap[BACKLOG]} overdueIds={overdueIds} onOpen={openDetail} />
          <div className="grid min-h-0 min-w-0 flex-1 grid-cols-3 grid-rows-2 gap-3">
            {days.slice(0, 5).map(d => (
              <DayColumn
                key={d.key}
                date={d.key}
                label={d.label}
                short={d.short}
                isToday={d.key === today}
                isPast={d.key < today}
                tasks={colMap[d.key]}
                onOpen={openDetail}
                onAdd={title => addTask({ title, scheduled_date: d.key })}
              />
            ))}
            {/* 토·일은 마지막 한 칸에 위아래 반반 */}
            <div className="grid min-h-0 grid-rows-2 gap-3">
              {days.slice(5).map(d => (
                <DayColumn
                  key={d.key}
                  date={d.key}
                  label={d.label}
                  short={d.short}
                  isToday={d.key === today}
                  isPast={d.key < today}
                  tasks={colMap[d.key]}
                  onOpen={openDetail}
                  onAdd={title => addTask({ title, scheduled_date: d.key })}
                />
              ))}
            </div>
          </div>
        </div>
        <DragOverlay>{activeTask ? <CardBody task={activeTask} overlay /> : null}</DragOverlay>
      </DndContext>
    </div>
  )
}

function BacklogColumn({ tasks, overdueIds, onOpen }: { tasks: Task[]; overdueIds: Set<string>; onOpen: (id: string) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: BACKLOG })
  return (
    <div
      ref={setNodeRef}
      className={`flex h-full min-h-0 w-[200px] shrink-0 flex-col rounded-lg border bg-zinc-100/70 dark:bg-zinc-900/70 ${isOver ? 'border-blue-400 dark:border-blue-600' : 'border-zinc-200 dark:border-zinc-800'}`}
    >
      <div className="flex items-center gap-2 px-3 pt-2.5 pb-1.5">
        <InboxIcon size={14} className="text-zinc-400" />
        <span className="text-[13.5px] font-bold">배정 대기</span>
        <span className="text-[12.5px] font-semibold text-zinc-400">{tasks.length}</span>
      </div>
      <SortableContext items={tasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
        <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-2 pb-2">
          {tasks.map(t => <SortableCard key={t.id} task={t} onOpen={onOpen} overdue={overdueIds.has(t.id)} />)}
        </div>
      </SortableContext>
    </div>
  )
}

function DayColumn({ date, label, short, isToday, isPast, tasks, onOpen, onAdd }: {
  date: string; label: string; short: string; isToday: boolean; isPast: boolean
  tasks: Task[]; onOpen: (id: string) => void; onAdd: (title: string) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${date}` })
  const [adding, setAdding] = useState(false)
  const [text, setText] = useState('')
  const commit = (keep: boolean) => { const v = text.trim(); if (v) onAdd(v); setText(''); if (!keep) setAdding(false) }
  return (
    <div
      ref={setNodeRef}
      className={`flex h-full min-h-0 min-w-0 flex-col rounded-lg border ${
        isToday ? 'border-blue-300 bg-blue-50/40 dark:border-blue-800 dark:bg-blue-950/20'
          : isOver ? 'border-blue-400 bg-zinc-100/70 dark:border-blue-600 dark:bg-zinc-900/70'
            : 'border-zinc-200 bg-zinc-100/70 dark:border-zinc-800 dark:bg-zinc-900/70'
      } ${isPast ? 'opacity-70' : ''}`}
    >
      <div className="flex items-center gap-1.5 px-3 pt-2.5 pb-1.5">
        <span className={`text-[13.5px] font-bold ${isToday ? 'text-blue-600 dark:text-blue-400' : ''}`}>{label}</span>
        <span className="text-[12px] font-medium text-zinc-400">{short}</span>
        <span className="text-[12.5px] font-semibold text-zinc-400">{tasks.length || ''}</span>
        <button className="ml-auto rounded p-0.5 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-800" onClick={() => setAdding(true)} title="태스크 추가"><Plus size={14} /></button>
      </div>
      <SortableContext items={tasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
        <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-2 pb-2">
          {tasks.map(t => <SortableCard key={t.id} task={t} onOpen={onOpen} />)}
          {adding && (
            <input
              autoFocus
              className="input !text-[13.5px]"
              placeholder="태스크 입력 후 Enter"
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') commit(true); if (e.key === 'Escape') { setText(''); setAdding(false) } }}
              onBlur={() => commit(false)}
            />
          )}
        </div>
      </SortableContext>
    </div>
  )
}

function SortableCard({ task, onOpen, overdue }: { task: Task; onOpen: (id: string) => void; overdue?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id })
  const selected = useStore(s => s.hoverTaskId === task.id)
  return (
    <div
      ref={setNodeRef}
      data-navid={task.id}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      className={isDragging ? 'opacity-40' : ''}
      onClick={() => onOpen(task.id)}
    >
      <CardBody task={task} selected={selected} overdue={overdue} />
    </div>
  )
}

function CardBody({ task, overlay, selected, overdue }: { task: Task; overlay?: boolean; selected?: boolean; overdue?: boolean }) {
  const toggleDone = useStore(s => s.toggleDone)
  const done = task.status === 'done'
  const ckTotal = countCk(task.checklist)
  const ckDone = countCk(task.checklist, true)
  return (
    <div
      className={`cursor-pointer rounded-md border bg-white p-2.5 shadow-[0_1px_2px_rgb(0_0_0/0.04)] transition-colors hover:border-blue-400 dark:bg-zinc-800/90 dark:hover:border-blue-600 ${
        overlay ? 'rotate-1 shadow-lg' : ''
      } ${done ? 'opacity-60' : ''} ${selected ? 'border-blue-400 ring-2 ring-blue-500/50 dark:border-blue-600' : 'border-zinc-200 dark:border-zinc-700'}`}
    >
      <div className="flex items-start gap-2">
        <button
          className={`mt-[1px] flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors ${done ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-zinc-300 text-transparent hover:border-emerald-500 dark:border-zinc-600'}`}
          title="완료 토글"
          onClick={e => { e.stopPropagation(); toggleDone(task.id) }}
          onPointerDown={e => e.stopPropagation()}
        >
          <Check size={11} strokeWidth={3} />
        </button>
        <div className="min-w-0 flex-1">
          <div className={`text-[13.5px] leading-snug ${done ? 'line-through' : ''}`}>{task.title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 empty:hidden">
            {overdue && task.scheduled_date && (
              <span className="rounded-full bg-red-50 px-1.5 py-px text-[11px] font-semibold text-red-600 dark:bg-red-950 dark:text-red-400">지연 {fmtDateShort(task.scheduled_date)}</span>
            )}
            {ckTotal > 0 && <span className="text-[12px] font-medium text-zinc-400">{ckDone}/{ckTotal}</span>}
            {task.deadline && !done && <DeadlineBadge deadline={task.deadline} />}
          </div>
        </div>
      </div>
    </div>
  )
}
