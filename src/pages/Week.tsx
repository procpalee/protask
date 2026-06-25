import { useEffect, useMemo, useState } from 'react'
import {
  DndContext, DragOverlay, PointerSensor, TouchSensor, closestCorners, pointerWithin,
  useDroppable, useSensor, useSensors, type CollisionDetection, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Square, SquareCheckBig, Plus, ChevronLeft, ChevronRight, Inbox as InboxIcon } from 'lucide-react'
import { startOfWeek, addDays, addWeeks, format } from 'date-fns'
import { ko } from 'date-fns/locale'
import { useStore, useNavOrder } from '../store/store'
import { useGcal } from '../store/gcalStore'
import { toStr, todayStr, fmtDateShort } from '../lib/dates'
import { between } from '../lib/position'
import { useTaskContextMenu } from '../components/TaskContextMenu'
import { countCk } from '../lib/group'
import { DeadlineBadge, Subtasks } from '../components/TaskRow'
import ProjectChip from '../components/ProjectChip'
import type { Task } from '../types'
import type { GcalEvent } from '../lib/gcal'

const BACKLOG = 'backlog'
const NONE = 'none'
const dsKey = (date: string, secId: string) => `${date}::${secId}`

/** 주간 플래너 보드 — 요일 7칸(각 칸: 캘린더 일정 + 시간 섹션별 태스크) + 백로그(미배정·지연).
 *  드래그로 scheduled_date·today_section 배정. 데스크탑 전용(/week). */
export default function WeekBoard() {
  const tasks = useStore(s => s.tasks)
  const sections = useStore(s => s.sections)
  const updateTask = useStore(s => s.updateTask)
  const addTask = useStore(s => s.addTask)
  const rebalance = useStore(s => s.rebalance)
  const openDetail = useStore(s => s.openDetail)
  const gcal = useGcal()
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
  const sortedSections = useMemo(() => [...sections].sort((a, b) => a.position - b.position), [sections])
  const secIds = useMemo(() => new Set(sortedSections.map(s => s.id)), [sortedSections])

  const { days, weekStart, weekEnd, weekEndExcl } = useMemo(() => {
    const start = startOfWeek(addWeeks(new Date(), weekOffset), { weekStartsOn: 1 })
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = addDays(start, i)
      return { key: toStr(d), label: format(d, 'EEE', { locale: ko }), short: fmtDateShort(toStr(d)) }
    })
    return { days, weekStart: days[0].key, weekEnd: days[6].key, weekEndExcl: toStr(addDays(start, 7)) }
  }, [weekOffset])

  // 캘린더 일정 로드(연결 시, 표시 주 범위)
  useEffect(() => { void gcal.init() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (gcal.status === 'connected') void gcal.ensureRange(weekStart, weekEndExcl)
  }, [gcal.status, weekStart, weekEndExcl]) // eslint-disable-line react-hooks/exhaustive-deps

  // 컬럼 맵: backlog + (요일×섹션). 요일 섹션 내부는 today_position 정렬.
  const { cols, overdueIds } = useMemo(() => {
    const map: Record<string, Task[]> = { [BACKLOG]: [] }
    for (const d of days) for (const sid of [NONE, ...sortedSections.map(s => s.id)]) map[dsKey(d.key, sid)] = []
    const overdue: Task[] = []
    const inbox: Task[] = []
    for (const t of tasks) {
      if (t.status === 'done') continue
      if (t.scheduled_date) {
        if (t.scheduled_date >= weekStart && t.scheduled_date <= weekEnd) {
          const sid = t.today_section && secIds.has(t.today_section) ? t.today_section : NONE
          map[dsKey(t.scheduled_date, sid)]?.push(t)
        } else if (t.scheduled_date < weekStart) overdue.push(t)
      } else if (!t.someday) inbox.push(t)
    }
    for (const k of Object.keys(map)) {
      if (k === BACKLOG) continue
      map[k].sort((a, b) => (a.today_position ?? 1e12) - (b.today_position ?? 1e12) || a.created_at.localeCompare(b.created_at))
    }
    overdue.sort((a, b) => (a.scheduled_date ?? '').localeCompare(b.scheduled_date ?? ''))
    inbox.sort((a, b) => b.created_at.localeCompare(a.created_at))
    map[BACKLOG] = [...overdue, ...inbox]
    return { cols: map, overdueIds: new Set(overdue.map(t => t.id)) }
  }, [tasks, days, sortedSections, secIds, weekStart, weekEnd])

  useNavOrder(useMemo(() => {
    const ids = [...cols[BACKLOG].map(t => t.id)]
    for (const d of days) for (const sid of [NONE, ...sortedSections.map(s => s.id)]) ids.push(...cols[dsKey(d.key, sid)].map(t => t.id))
    return ids
  }, [cols, days, sortedSections]))

  const colOf = (id: string): string | null => {
    for (const k of Object.keys(cols)) if (cols[k].some(t => t.id === id)) return k
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
    const isZone = overId === BACKLOG || overId.includes('::')
    if (isZone) {
      targetKey = overId
      ids = cols[targetKey].map(t => t.id).filter(id => id !== taskId)
      insertAt = ids.length
    } else {
      targetKey = colOf(overId) ?? ''
      if (!targetKey) return
      const col = cols[targetKey]
      const origIdx = col.findIndex(t => t.id === taskId)
      const overIdx = col.findIndex(t => t.id === overId)
      ids = col.map(t => t.id).filter(id => id !== taskId)
      const overPos = ids.indexOf(overId)
      insertAt = origIdx !== -1 && origIdx < overIdx ? overPos + 1 : overPos
    }

    if (fromKey === targetKey) {
      const before = cols[targetKey].map(t => t.id)
      const after = [...ids.slice(0, insertAt), taskId, ...ids.slice(insertAt)]
      if (before.join() === after.join()) return
    }

    const field: 'position' | 'today_position' = targetKey === BACKLOG ? 'position' : 'today_position'
    // 컬럼 이동 패치
    let datePatch: Partial<Task> = {}
    if (fromKey !== targetKey) {
      if (targetKey === BACKLOG) datePatch = { scheduled_date: null, someday: false }
      else {
        const [date, secId] = targetKey.split('::')
        datePatch = { scheduled_date: date, someday: false, today_section: secId === NONE ? null : secId }
      }
    }

    const prevPos = ids[insertAt - 1] ? tasks.find(t => t.id === ids[insertAt - 1])?.[field] ?? undefined : undefined
    const nextPos = ids[insertAt] ? tasks.find(t => t.id === ids[insertAt])?.[field] ?? undefined : undefined
    const pos = between(prevPos, nextPos)
    if (Number.isNaN(pos)) {
      updateTask(taskId, datePatch)
      rebalance([...ids.slice(0, insertAt), taskId, ...ids.slice(insertAt)], field)
    } else {
      updateTask(taskId, { ...datePatch, [field]: pos })
    }
  }

  const activeTask = activeId ? tasks.find(t => t.id === activeId) : null
  const rangeLabel = `${fmtDateShort(weekStart)} – ${fmtDateShort(weekEnd)}`

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 px-5 pt-5 pb-3">
        <h1 className="text-[19px] font-bold tracking-tight">This Week</h1>
        <span className="text-[15px] font-medium text-zinc-400">{rangeLabel}</span>
        <div className="ml-auto flex items-center gap-1">
          <button className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800" onClick={() => setWeekOffset(o => o - 1)} title="이전 주"><ChevronLeft size={16} /></button>
          <button className={`rounded-md px-2 py-1 text-[14px] font-semibold ${weekOffset === 0 ? 'text-zinc-300 dark:text-zinc-600' : 'text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950'}`} onClick={() => setWeekOffset(0)} disabled={weekOffset === 0}>이번주</button>
          <button className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800" onClick={() => setWeekOffset(o => o + 1)} title="다음 주"><ChevronRight size={16} /></button>
        </div>
      </div>

      <DndContext sensors={sensors} collisionDetection={collision} autoScroll={false} onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
        <div className="flex min-h-0 flex-1 gap-3 px-5 pb-5">
          <BacklogColumn tasks={cols[BACKLOG]} overdueIds={overdueIds} onOpen={openDetail} />
          <div className="grid min-h-0 min-w-0 flex-1 grid-cols-3 grid-rows-2 gap-3">
            {days.slice(0, 5).map(d => (
              <DayColumn key={d.key} date={d.key} label={d.label} short={d.short}
                isToday={d.key === today} isPast={d.key < today}
                sections={sortedSections} cols={cols} events={gcal.eventsOn(d.key)}
                onOpen={openDetail} onAdd={title => addTask({ title, scheduled_date: d.key })} />
            ))}
            <div className="grid min-h-0 grid-rows-2 gap-3">
              {days.slice(5).map(d => (
                <DayColumn key={d.key} date={d.key} label={d.label} short={d.short}
                  isToday={d.key === today} isPast={d.key < today}
                  sections={sortedSections} cols={cols} events={gcal.eventsOn(d.key)}
                  onOpen={openDetail} onAdd={title => addTask({ title, scheduled_date: d.key })} />
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
      className={`flex h-full min-h-0 w-[280px] shrink-0 flex-col rounded-lg border bg-zinc-100/70 dark:bg-zinc-900/70 ${isOver ? 'border-blue-400 dark:border-blue-600' : 'border-zinc-200 dark:border-zinc-800'}`}
    >
      <div className="flex items-center gap-2 px-3 pt-2.5 pb-1.5">
        <InboxIcon size={14} className="text-zinc-400" />
        <span className="text-[15px] font-bold">배정 대기</span>
        <span className="text-[13.5px] font-semibold text-zinc-400">{tasks.length}</span>
      </div>
      <SortableContext items={tasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
        <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-2 pb-2">
          {tasks.map(t => <SortableCard key={t.id} task={t} onOpen={onOpen} overdue={overdueIds.has(t.id)} />)}
        </div>
      </SortableContext>
    </div>
  )
}

function DayColumn({ date, label, short, isToday, isPast, sections, cols, events, onOpen, onAdd }: {
  date: string; label: string; short: string; isToday: boolean; isPast: boolean
  sections: { id: string; name: string }[]
  cols: Record<string, Task[]>
  events: GcalEvent[]
  onOpen: (id: string) => void; onAdd: (title: string) => void
}) {
  const [adding, setAdding] = useState(false)
  const [text, setText] = useState('')
  const commit = (keep: boolean) => { const v = text.trim(); if (v) onAdd(v); setText(''); if (!keep) setAdding(false) }
  const count = [NONE, ...sections.map(s => s.id)].reduce((n, sid) => n + (cols[dsKey(date, sid)]?.length ?? 0), 0)
  return (
    <div
      className={`flex h-full min-h-0 min-w-0 flex-col rounded-lg border ${
        isToday ? 'border-blue-300 bg-blue-50/40 dark:border-blue-800 dark:bg-blue-950/20'
          : 'border-zinc-200 bg-zinc-100/70 dark:border-zinc-800 dark:bg-zinc-900/70'
      } ${isPast ? 'opacity-70' : ''}`}
    >
      <div className="flex items-center gap-1.5 px-3 pt-2.5 pb-1.5">
        <span className={`text-[15px] font-bold ${isToday ? 'text-blue-600 dark:text-blue-400' : ''}`}>{label}</span>
        <span className="text-[13px] font-medium text-zinc-400">{short}</span>
        <span className="text-[13.5px] font-semibold text-zinc-400">{count || ''}</span>
        <button className="ml-auto rounded p-0.5 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-800" onClick={() => setAdding(true)} title="태스크 추가"><Plus size={14} /></button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2 pb-2">
        {events.length > 0 && (
          <div className="mb-0.5 flex flex-col gap-px rounded-md bg-white/60 px-1 py-1 dark:bg-zinc-800/40">
            {events.map(ev => <EventRow key={ev.id} ev={ev} />)}
          </div>
        )}
        <SectionZone date={date} secId={NONE} tasks={cols[dsKey(date, NONE)] ?? []} onOpen={onOpen} />
        {adding && (
          <input
            autoFocus
            className="input !text-[14.5px]"
            placeholder="태스크 입력 후 Enter"
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') commit(true); if (e.key === 'Escape') { setText(''); setAdding(false) } }}
            onBlur={() => commit(false)}
          />
        )}
        {sections.map(s => (
          <SectionZone key={s.id} date={date} secId={s.id} label={s.name} tasks={cols[dsKey(date, s.id)] ?? []} onOpen={onOpen} />
        ))}
      </div>
    </div>
  )
}

function SectionZone({ date, secId, label, tasks, onOpen }: { date: string; secId: string; label?: string; tasks: Task[]; onOpen: (id: string) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: dsKey(date, secId) })
  return (
    <div ref={setNodeRef} className={`rounded-md ${isOver ? 'bg-blue-100/50 dark:bg-blue-950/30' : ''}`}>
      {label && <div className="px-1 pt-1 pb-0.5 text-[12.5px] font-semibold tracking-wide text-zinc-400">{label}</div>}
      <SortableContext items={tasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
        <div className="flex min-h-[8px] flex-col gap-1.5">
          {tasks.map(t => <SortableCard key={t.id} task={t} onOpen={onOpen} />)}
        </div>
      </SortableContext>
    </div>
  )
}

function EventRow({ ev }: { ev: GcalEvent }) {
  return (
    <div className="flex items-center gap-1.5 px-1 py-0.5 text-[13px] text-zinc-500 dark:text-zinc-400" title={ev.summary}>
      <span className="h-1.5 w-1.5 shrink-0 rounded-[2px]" style={{ background: ev.color ?? '#3b82f6' }} />
      <span className="shrink-0 tabular-nums">{ev.allDay ? '종일' : ev.start.slice(11, 16)}</span>
      <span className="truncate">{ev.summary}</span>
    </div>
  )
}

function SortableCard({ task, onOpen, overdue }: { task: Task; onOpen: (id: string) => void; overdue?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id })
  const selected = useStore(s => s.hoverTaskId === task.id)
  const { onContextMenu, menu } = useTaskContextMenu(task, onOpen)
  return (
    <>
      <div
        ref={setNodeRef}
        data-navid={task.id}
        style={{ transform: CSS.Transform.toString(transform), transition }}
        {...attributes}
        {...listeners}
        className={isDragging ? 'opacity-40' : ''}
        onClick={() => onOpen(task.id)}
        onContextMenu={onContextMenu}
      >
        <CardBody task={task} selected={selected} overdue={overdue} />
      </div>
      {menu}
    </>
  )
}

function CardBody({ task, overlay, selected, overdue }: { task: Task; overlay?: boolean; selected?: boolean; overdue?: boolean }) {
  const toggleDone = useStore(s => s.toggleDone)
  const updateTask = useStore(s => s.updateTask)
  const done = task.status === 'done'
  const ckTotal = countCk(task.checklist)
  const ckDone = countCk(task.checklist, true)
  return (
    <div
      className={`cursor-pointer rounded-md border bg-white p-2 shadow-[0_1px_2px_rgb(0_0_0/0.04)] transition-colors hover:border-blue-400 dark:bg-zinc-800/90 dark:hover:border-blue-600 ${
        overlay ? 'rotate-1 shadow-lg' : ''
      } ${done ? 'opacity-60' : ''} ${selected ? 'border-blue-400 ring-2 ring-blue-500/50 dark:border-blue-600' : 'border-zinc-200 dark:border-zinc-700'}`}
    >
      <div className="flex items-start gap-2">
        <button
          className={`mt-[1px] shrink-0 ${done ? 'text-emerald-500' : 'text-zinc-300 hover:text-emerald-500 dark:text-zinc-600'}`}
          title="완료 토글"
          onClick={e => { e.stopPropagation(); toggleDone(task.id) }}
          onPointerDown={e => e.stopPropagation()}
        >
          {done ? <SquareCheckBig size={16} /> : <Square size={16} />}
        </button>
        <div className="min-w-0 flex-1">
          <div className={`text-[14.5px] leading-snug ${done ? 'line-through' : ''}`}>{task.title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 empty:hidden">
            {overdue && task.scheduled_date && (
              <span className="rounded-full bg-red-50 px-1.5 py-px text-[12px] font-semibold text-red-600 dark:bg-red-950 dark:text-red-400">지연 {fmtDateShort(task.scheduled_date)}</span>
            )}
            {ckTotal > 0 && <span className="text-[13px] font-medium text-zinc-400">{ckDone}/{ckTotal}</span>}
            {task.deadline && !done && <DeadlineBadge deadline={task.deadline} />}
            <ProjectChip projectId={task.project_id} workspaceId={task.workspace_id} />
          </div>
        </div>
      </div>
      {task.checklist.length > 0 && (
        <Subtasks items={task.checklist} projectId={task.project_id} workspaceId={task.workspace_id} onChange={next => updateTask(task.id, { checklist: next })} />
      )}
    </div>
  )
}
