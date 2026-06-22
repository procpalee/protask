import { useEffect, useMemo, useState } from 'react'
import {
  DndContext, DragOverlay, PointerSensor, TouchSensor,
  useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core'
import { addDays, addMonths, addWeeks, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameMonth, startOfMonth, startOfWeek } from 'date-fns'
import { ChevronDown, ChevronLeft, ChevronRight, Flag, Inbox, Moon, PanelRightClose, PanelRightOpen, Plus } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useStore, selInbox, selSomeday, projectColor } from '../store/store'
import { useGcal } from '../store/gcalStore'
import type { Task } from '../types'
import { todayStr, toStr } from '../lib/dates'
import { eventDays, type GcalEvent } from '../lib/gcal'
import ProjectChip from '../components/ProjectChip'
import GcalEventModal from '../components/GcalEventModal'

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토']

export default function CalendarPage() {
  const tasks = useStore(s => s.tasks)
  const workspaces = useStore(s => s.workspaces)
  const projects = useStore(s => s.projects)
  const updateTask = useStore(s => s.updateTask)
  const [view, setView] = useState<'month' | 'week'>('month')
  const [anchor, setAnchor] = useState(() => new Date())
  const openDetail = useStore(s => s.openDetail)
  const inbox = useStore(useShallow(selInbox))
  const someday = useStore(useShallow(selSomeday))
  const [panelOpen, setPanelOpen] = useState(true)
  const [somedayOpen, setSomedayOpen] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [panelW, setPanelW] = useState(() => { const v = Number(localStorage.getItem('pd-calpanel')); return v >= 220 && v <= 600 ? v : 300 })
  useEffect(() => { localStorage.setItem('pd-calpanel', String(panelW)) }, [panelW])
  // 구글 일정 생성/편집 모달
  const [modalEvent, setModalEvent] = useState<GcalEvent | null>(null)
  const [createDate, setCreateDate] = useState<string | null>(null)
  // 워크스페이스·프로젝트 필터 (''=전체)
  const [fWs, setFWs] = useState('') // ''=전체, '__none'=워크스페이스 없음
  const [fProj, setFProj] = useState('')
  const passF = (t: Task) => {
    if (fWs === '__none') { if (t.workspace_id) return false }
    else if (fWs && t.workspace_id !== fWs) return false
    if (fProj && t.project_id !== fProj) return false
    return true
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  )

  const days = useMemo(
    () =>
      view === 'week'
        ? eachDayOfInterval({ start: startOfWeek(anchor), end: endOfWeek(anchor) })
        : eachDayOfInterval({ start: startOfWeek(startOfMonth(anchor)), end: endOfWeek(endOfMonth(anchor)) }),
    [anchor, view],
  )

  // W: 주간 · M: 월간 (입력 중·조합키 제외)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const k = e.key.toLowerCase()
      if (k === 'w') setView('week')
      else if (k === 'm') setView('month')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const gcal = useGcal()
  useEffect(() => {
    void gcal.init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (gcal.status === 'connected' && days.length)
      void gcal.ensureRange(toStr(days[0]), toStr(addDays(days[days.length - 1], 1)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gcal.status, anchor, view])

  const eventsByDate = useMemo(() => {
    const map = new Map<string, GcalEvent[]>()
    if (gcal.status !== 'connected') return map
    for (const e of gcal.events) {
      if (gcal.selected !== null && !gcal.selected.includes(e.calendarId)) continue
      for (const day of eventDays(e)) { // 다일 일정은 걸치는 모든 날에 표시
        if (!map.has(day)) map.set(day, [])
        map.get(day)!.push(e)
      }
    }
    return map
  }, [gcal.events, gcal.status, gcal.selected])

  const byDate = useMemo(() => {
    const map = new Map<string, Task[]>()
    for (const t of tasks) {
      if (!t.scheduled_date || !passF(t)) continue
      if (!map.has(t.scheduled_date)) map.set(t.scheduled_date, [])
      map.get(t.scheduled_date)!.push(t)
    }
    for (const list of map.values()) list.sort((a, b) => (a.today_position ?? 1e12) - (b.today_position ?? 1e12) || a.position - b.position)
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, fWs, fProj])

  const deadlineByDate = useMemo(() => {
    const map = new Map<string, Task[]>()
    for (const t of tasks) {
      if (!t.deadline || t.status === 'done' || !passF(t)) continue
      if (!map.has(t.deadline)) map.set(t.deadline, [])
      map.get(t.deadline)!.push(t)
    }
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, fWs, fProj])

  const fInbox = useMemo(() => inbox.filter(passF), [inbox, fWs, fProj]) // eslint-disable-line react-hooks/exhaustive-deps
  const fSomeday = useMemo(() => someday.filter(passF), [someday, fWs, fProj]) // eslint-disable-line react-hooks/exhaustive-deps
  const projOptions = useMemo(() => (fWs ? projects.filter(p => p.workspace_id === fWs) : projects), [projects, fWs])

  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null)
    const { active, over } = e
    if (!over) return
    const overId = String(over.id)
    const activeIdStr = String(active.id)
    // 구글캘린더 일정 드래그 → 날짜 변경(구글에 쓰기)
    if (activeIdStr.startsWith('gcal:')) {
      if (overId.startsWith('day:')) {
        const date = overId.slice(4)
        const ev = gcal.events.find(x => x.id === activeIdStr.slice(5))
        if (ev && ev.date !== date) void gcal.reschedule(ev, date)
      }
      return
    }
    const task = tasks.find(t => t.id === activeIdStr)
    if (!task) return
    if (overId.startsWith('day:')) {
      const date = overId.slice(4)
      if (task.scheduled_date !== date) updateTask(task.id, { scheduled_date: date })
    } else if (overId === 'panel:inbox') {
      updateTask(task.id, { scheduled_date: null, someday: false })
    } else if (overId === 'panel:someday') {
      updateTask(task.id, { someday: true }) // store 규칙이 날짜 해제
    }
  }

  const activeTask = activeId && !activeId.startsWith('gcal:') ? tasks.find(t => t.id === activeId) : null
  const activeEvent = activeId?.startsWith('gcal:') ? gcal.events.find(x => x.id === activeId.slice(5)) : null
  const today = todayStr()
  const canCreateEvent = gcal.status === 'connected' && gcal.writableCalendars().length > 0

  const title = view === 'week'
    ? `${format(days[0], 'M월 d일')} – ${format(days[days.length - 1], 'M월 d일')}`
    : format(anchor, 'yyyy년 M월')
  const step = (dir: -1 | 1) => setAnchor(a => (view === 'week' ? addWeeks(a, dir) : addMonths(a, dir)))

  return (
    <div className="flex h-full flex-col px-5 py-5">
      <div className="mb-3 flex items-center gap-2">
        <h1 className="text-[19px] font-bold tracking-tight">{title}</h1>
        <div className="ml-2 flex items-center rounded-md border border-zinc-200 p-0.5 dark:border-zinc-700">
          <button
            className={`rounded px-2 py-0.5 text-[13px] font-semibold ${view === 'week' ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-50' : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'}`}
            onClick={() => setView('week')}
            title="주간 (W)"
          >주</button>
          <button
            className={`rounded px-2 py-0.5 text-[13px] font-semibold ${view === 'month' ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-50' : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'}`}
            onClick={() => setView('month')}
            title="월간 (M)"
          >월</button>
        </div>

        {/* 워크스페이스·프로젝트 필터 */}
        <select
          className="input !h-7 !w-auto !py-0 !text-[13px]"
          value={fWs}
          onChange={e => { setFWs(e.target.value); setFProj('') }}
          title="프로젝트 필터"
        >
          <option value="">전체 프로젝트</option>
          <option value="__none">프로젝트 없음</option>
          {workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <select
          className="input !h-7 !w-auto !py-0 !text-[13px]"
          value={fProj}
          onChange={e => setFProj(e.target.value)}
          title="서브프로젝트 필터"
        >
          <option value="">전체 서브프로젝트</option>
          {projOptions.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
        </select>
        {(fWs || fProj) && (
          <button className="btn !px-1.5 !py-0.5 !text-[12px]" onClick={() => { setFWs(''); setFProj('') }} title="필터 초기화">초기화</button>
        )}

        <div className="ml-auto flex items-center gap-1">
          <button className="btn !px-2" onClick={() => step(-1)} title={view === 'week' ? '이전 주' : '이전 달'}><ChevronLeft size={14} /></button>
          <button className="btn" onClick={() => setAnchor(new Date())}>오늘</button>
          <button className="btn !px-2" onClick={() => step(1)} title={view === 'week' ? '다음 주' : '다음 달'}><ChevronRight size={14} /></button>
          <button className="btn !px-2" onClick={() => setPanelOpen(o => !o)} title={panelOpen ? 'Inbox 패널 접기' : 'Inbox 패널 열기'}>
            {panelOpen ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
          </button>
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
                return (
                  <DayCell
                    key={ds}
                    date={d}
                    dateStr={ds}
                    inMonth={view === 'week' ? true : isSameMonth(d, anchor)}
                    isToday={ds === today}
                    maxTasks={view === 'week' ? 30 : 4}
                    tasks={byDate.get(ds) ?? []}
                    deadlines={deadlineByDate.get(ds) ?? []}
                    events={eventsByDate.get(ds) ?? []}
                    colorOf={t => projectColor(t.project_id, projects)}
                    onOpen={openDetail}
                    onEventOpen={setModalEvent}
                    onCreate={canCreateEvent ? setCreateDate : undefined}
                  />
                )
              })}
            </div>
          </div>

          {panelOpen && (
            <>
              <PanelResizer width={panelW} setWidth={setPanelW} />
              <SidePanel
                width={panelW}
                inbox={fInbox}
                someday={fSomeday}
                somedayOpen={somedayOpen}
                onToggleSomeday={() => setSomedayOpen(o => !o)}
                onOpen={openDetail}
              />
            </>
          )}
        </div>

        <DragOverlay>
          {activeTask ? (
            <div className="rounded border border-blue-300 bg-white px-2 py-1 text-[12.5px] shadow-lg dark:border-blue-700 dark:bg-zinc-800">
              {activeTask.title}
            </div>
          ) : activeEvent ? (
            <div
              className={`px-2 py-1 text-[12.5px] font-medium shadow-lg ${
                activeEvent.allDay ? 'rounded-sm text-white' : 'rounded-r-sm bg-white text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'
              }`}
              style={activeEvent.allDay ? { background: activeEvent.color ?? '#3b82f6' } : { borderLeft: `3px solid ${activeEvent.color ?? '#3b82f6'}` }}
            >
              {activeEvent.summary}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {modalEvent && <GcalEventModal mode="edit" event={modalEvent} onClose={() => setModalEvent(null)} />}
      {createDate && <GcalEventModal mode="create" initialDate={createDate} onClose={() => setCreateDate(null)} />}
    </div>
  )
}

function DayCell({
  date, dateStr, inMonth, isToday, maxTasks, tasks, deadlines, events, colorOf, onOpen, onEventOpen, onCreate,
}: {
  date: Date
  dateStr: string
  inMonth: boolean
  isToday: boolean
  maxTasks: number
  tasks: Task[]
  deadlines: Task[]
  events: GcalEvent[]
  colorOf: (t: Task) => string
  onOpen: (id: string) => void
  onEventOpen: (ev: GcalEvent) => void
  onCreate?: (date: string) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${dateStr}` })
  const day = date.getDay()
  return (
    <div
      ref={setNodeRef}
      className={`group flex min-h-[96px] flex-col border-r border-b border-zinc-100 p-1 dark:border-zinc-800/70 ${
        !inMonth ? 'bg-zinc-50/60 dark:bg-zinc-900/40' : day === 0 || day === 6 ? 'bg-zinc-50/40 dark:bg-zinc-900/20' : ''
      } ${isOver ? 'bg-blue-50/70 ring-1 ring-blue-400 ring-inset dark:bg-blue-950/30' : ''}`}
    >
      <div className="mb-0.5 flex items-center gap-1 px-1">
        <span className={`text-[12.5px] font-semibold ${
          isToday
            ? 'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-blue-600 px-1 text-white'
            : !inMonth ? 'text-zinc-300 dark:text-zinc-600' : day === 0 ? 'text-red-400' : day === 6 ? 'text-blue-400' : 'text-zinc-500'
        }`}>
          {date.getDate()}
        </span>
        {onCreate && (
          <button
            onClick={() => onCreate(dateStr)}
            className="ml-auto rounded p-0.5 text-zinc-400 opacity-0 transition hover:bg-blue-100 hover:text-blue-600 group-hover:opacity-100 dark:hover:bg-blue-950 dark:hover:text-blue-400"
            title="이 날짜에 일정 추가"
          >
            <Plus size={13} />
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
        {events.map(ev => <EventChip key={'ev' + ev.id} ev={ev} onOpen={onEventOpen} />)}
        {tasks.slice(0, maxTasks).map(t => <CalChip key={t.id} task={t} color={colorOf(t)} onOpen={onOpen} />)}
        {tasks.length > maxTasks && <div className="px-1 text-[12.5px] font-medium text-zinc-400">+{tasks.length - maxTasks}개 더</div>}
        {deadlines.map(t => (
          <button
            key={'dl' + t.id}
            className="flex w-full items-center gap-1 truncate rounded border border-red-200 bg-red-50/70 px-1 py-0.5 text-left text-[12.5px] font-medium text-red-600 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400"
            title={`마감: ${t.title}`}
            onClick={() => onOpen(t.id)}
          >
            <Flag size={9} className="shrink-0" />
            <span className="truncate">{t.title}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function CalChip({ task, color, onOpen }: { task: Task; color: string; onOpen: (id: string) => void }) {
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
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
      <span className={`truncate ${done ? 'line-through' : ''}`}>{task.title}</span>
    </div>
  )
}

/* 구글캘린더 일정 칩 — 클릭=편집, 드래그=날짜 이동(구글에 반영) */
function EventChip({ ev, onOpen }: { ev: GcalEvent; onOpen: (ev: GcalEvent) => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `gcal:${ev.id}` })
  const color = ev.color ?? '#3b82f6'
  // 종일=배경 전체 색칠(구글캘린더 스타일), 시간 일정=좌측 보더 + 시각
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => onOpen(ev)}
      className={`flex cursor-pointer items-center gap-1 truncate px-1 py-0.5 text-[12.5px] font-medium ${
        ev.allDay ? 'rounded-sm text-white' : 'rounded-r-sm text-zinc-500 dark:text-zinc-400'
      } ${isDragging ? 'opacity-40' : ''}`}
      style={ev.allDay ? { background: color } : { borderLeft: `3px solid ${color}`, background: 'rgb(0 0 0 / 0.03)' }}
      title={`${ev.summary}${ev.allDay ? ' (종일)' : ` ${ev.start.slice(11, 16)}`} · ${ev.calendar ?? ''} — 클릭 편집 / 드래그 이동`}
    >
      {!ev.allDay && <span className="shrink-0 text-[11px] text-zinc-400">{ev.start.slice(11, 16)}</span>}
      <span className="truncate">{ev.summary}</span>
    </div>
  )
}

/* 드래그로 패널 너비 조절 (md 이상) */
function PanelResizer({ width, setWidth }: { width: number; setWidth: (w: number) => void }) {
  const onDown = (e: React.PointerEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = width
    const move = (ev: PointerEvent) => setWidth(Math.min(600, Math.max(220, startW + (startX - ev.clientX))))
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  return (
    <div
      onPointerDown={onDown}
      title="드래그하여 패널 너비 조절"
      className="hidden w-1.5 shrink-0 cursor-col-resize rounded bg-zinc-200/0 transition-colors hover:bg-blue-400/50 md:block dark:hover:bg-blue-500/50"
    />
  )
}

/* ───── 사이드 패널 (Inbox + 선택적 Someday) ───── */
function SidePanel({ width, inbox, someday, somedayOpen, onToggleSomeday, onOpen }: {
  width: number; inbox: Task[]; someday: Task[]; somedayOpen: boolean; onToggleSomeday: () => void; onOpen: (id: string) => void
}) {
  return (
    <aside className="hidden shrink-0 flex-col gap-2 overflow-y-auto md:flex" style={{ width }}>
      <PanelSection dropId="panel:inbox" icon={<Inbox size={14} className="text-zinc-400" />} title="Inbox" tasks={inbox} emptyText="Inbox가 비었습니다 ✓" onOpen={onOpen} />
      {somedayOpen ? (
        <PanelSection
          dropId="panel:someday"
          icon={<Moon size={14} className="text-violet-400" />}
          title="Someday"
          tasks={someday}
          emptyText="보류 중인 항목 없음"
          onOpen={onOpen}
          onCollapse={onToggleSomeday}
        />
      ) : (
        <button
          onClick={onToggleSomeday}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-200 bg-zinc-50/50 px-3 py-2 hover:border-violet-300 dark:border-zinc-800 dark:bg-zinc-900/40 dark:hover:border-violet-700"
          title="Someday 열기"
        >
          <Moon size={14} className="text-violet-400" />
          <span className="text-[13.5px] font-bold">Someday</span>
          <span className="text-[12px] font-semibold text-zinc-400">{someday.length}</span>
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
          <button onClick={onCollapse} className="ml-auto rounded p-0.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200" title="접기">
            <ChevronDown size={14} />
          </button>
        ) : (
          <span className="ml-auto text-[11.5px] text-zinc-400">{isOver ? '여기에 놓기' : '드래그'}</span>
        )}
      </div>
      <div className="flex-1 space-y-1 overflow-y-auto p-2">
        {tasks.map(t => <InboxDragRow key={t.id} task={t} onOpen={onOpen} />)}
        {tasks.length === 0 && <p className="px-1 py-3 text-center text-[13px] text-zinc-400">{emptyText}</p>}
      </div>
    </div>
  )
}

function InboxDragRow({ task, onOpen }: { task: Task; onOpen: (id: string) => void }) {
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
