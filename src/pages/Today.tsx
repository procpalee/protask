import { useEffect, useMemo, useState } from 'react'
import {
  DndContext, DragOverlay, PointerSensor, TouchSensor, closestCorners,
  useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { CalendarX2, RefreshCw, CalendarDays, Plus, Pencil, Trash2, ChevronUp, ChevronDown, Folder } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useStore, selToday, selOverdue, useNavOrder } from '../store/store'
import { promptDialog, confirmDialog } from '../store/dialogStore'
import { useGcal } from '../store/gcalStore'
import type { Task } from '../types'
import { between } from '../lib/position'
import { fmtDate, todayStr, toStr, daysFromToday } from '../lib/dates'
import { addDays } from 'date-fns'
import TaskRow from '../components/TaskRow'
import { Link } from 'react-router-dom'

const NONE = 'none'

/** Today — 오늘 할 일 단일 리스트(섹션별 그룹). 주간 보드는 /week 로 분리. */
export default function TodayPage() {
  const todayTasks = useStore(useShallow(selToday))
  const overdue = useStore(useShallow(selOverdue))
  const sections = useStore(s => s.sections)
  const updateTask = useStore(s => s.updateTask)
  const rebalance = useStore(s => s.rebalance)
  const addSection = useStore(s => s.addSection)
  const addTask = useStore(s => s.addTask)
  const allTasks = useStore(s => s.tasks)
  const openDetail = useStore(s => s.openDetail)
  const workspaces = useStore(s => s.workspaces)
  const projects = useStore(s => s.projects)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [groupBy, setGroupBy] = useState<'section' | 'project'>(() => (localStorage.getItem('pd-todaygroup') === 'project' ? 'project' : 'section'))
  const setGroupByP = (g: 'section' | 'project') => { setGroupBy(g); localStorage.setItem('pd-todaygroup', g) }
  const addSectionPrompt = async () => {
    const name = await promptDialog({ title: '새 섹션', placeholder: '예: 아침, 오전, 집중시간', confirmLabel: '추가' })
    if (name?.trim()) addSection(name.trim())
  }

  const submit = () => {
    const v = text.trim()
    if (!v) return
    addTask({ title: v, scheduled_date: todayStr() })
    setText('')
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  )

  const sorted = useMemo(() => [...sections].sort((a, b) => a.position - b.position), [sections])
  const secIds = useMemo(() => new Set(sorted.map(s => s.id)), [sorted])
  const keys = useMemo(() => [NONE, ...sorted.map(s => s.id)], [sorted])

  const bySec = useMemo(() => {
    const map: Record<string, Task[]> = {}
    for (const k of keys) map[k] = []
    for (const t of todayTasks) {
      const k = t.today_section && secIds.has(t.today_section) ? t.today_section : NONE
      map[k].push(t)
    }
    for (const k of keys)
      map[k].sort((a, b) => (a.today_position ?? 1e12) - (b.today_position ?? 1e12) || a.created_at.localeCompare(b.created_at))
    return map
  }, [todayTasks, keys, secIds])

  // 프로젝트(워크스페이스 ▸ 서브프로젝트) 그룹 — 완료 제외
  const wsGroups = useMemo(() => {
    const act = todayTasks.filter(t => t.status !== 'done')
    const noWs = act.filter(t => !t.workspace_id)
    const byWs = new Map<string, Task[]>()
    for (const t of act) { if (!t.workspace_id) continue; if (!byWs.has(t.workspace_id)) byWs.set(t.workspace_id, []); byWs.get(t.workspace_id)!.push(t) }
    const groups = workspaces.filter(w => byWs.has(w.id)).map(w => {
      const wt = byWs.get(w.id)!
      const wp = projects.filter(p => p.workspace_id === w.id).sort((a, b) => a.position - b.position)
      const subs = wp.map(p => ({ project: p, tasks: wt.filter(t => t.project_id === p.id) })).filter(s => s.tasks.length)
      const noProj = wt.filter(t => !t.project_id || !wp.some(p => p.id === t.project_id))
      return { ws: w, subs, noProj }
    })
    return { noWs, groups }
  }, [todayTasks, workspaces, projects])

  // 키보드 내비 순서: Overdue → To-do(현재 그룹 순) → Done
  const todoOrder = useMemo(() => {
    if (groupBy === 'project')
      return [...wsGroups.noWs, ...wsGroups.groups.flatMap(g => [...g.subs.flatMap(s => s.tasks), ...g.noProj])].map(t => t.id)
    return keys.flatMap(k => (bySec[k] ?? []).filter(t => t.status !== 'done').map(t => t.id))
  }, [groupBy, wsGroups, keys, bySec])
  useNavOrder(useMemo(
    () => [...new Set([...overdue.map(t => t.id), ...todoOrder, ...todayTasks.filter(t => t.status === 'done').map(t => t.id)])],
    [overdue, todoOrder, todayTasks],
  ))

  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id))

  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null)
    const { active, over } = e
    if (!over) return
    const taskId = String(active.id)
    const task = allTasks.find(t => t.id === taskId)
    if (!task) return

    const overId = String(over.id)
    let sec: string
    let ids: string[]
    let insertAt: number

    if (overId.startsWith('sec:')) {
      sec = overId.slice(4)
      ids = (bySec[sec] ?? []).map(t => t.id).filter(id => id !== taskId)
      insertAt = ids.length
    } else {
      const overTask = todayTasks.find(t => t.id === overId)
      if (!overTask) return
      sec = overTask.today_section && secIds.has(overTask.today_section) ? overTask.today_section : NONE
      const col = bySec[sec] ?? []
      const origIdx = col.findIndex(t => t.id === taskId)
      const overIdx = col.findIndex(t => t.id === overId)
      ids = col.map(t => t.id).filter(id => id !== taskId)
      const overPos = ids.indexOf(overId)
      insertAt = origIdx !== -1 && origIdx < overIdx ? overPos + 1 : overPos
    }

    const prevId = ids[insertAt - 1]
    const nextId = ids[insertAt]
    const prevPos = prevId ? todayTasks.find(t => t.id === prevId)?.today_position ?? undefined : undefined
    const nextPos = nextId ? todayTasks.find(t => t.id === nextId)?.today_position ?? undefined : undefined
    const pos = between(prevPos ?? undefined, nextPos ?? undefined)
    if (Number.isNaN(pos)) {
      const order = [...ids]
      order.splice(insertAt, 0, taskId)
      updateTask(taskId, { scheduled_date: todayStr(), today_section: sec === NONE ? null : sec })
      rebalance(order, 'today_position')
      return
    }
    updateTask(taskId, { scheduled_date: todayStr(), today_section: sec === NONE ? null : sec, today_position: pos })
  }

  const activeTask = activeId ? allTasks.find(t => t.id === activeId) : null
  const doneToday = useMemo(() => todayTasks.filter(t => t.status === 'done'), [todayTasks])
  const doneCount = doneToday.length
  const todoCount = todayTasks.length - doneCount

  return (
    <div className="mx-auto max-w-[820px] px-5 py-5">
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h1 className="text-[19px] font-bold tracking-tight">Today</h1>
        <span className="text-[13.5px] font-medium text-zinc-400">{fmtDate(todayStr())} · {doneCount}/{todayTasks.length} 완료</span>
        <div className="ml-auto flex items-center rounded-md border border-zinc-200 p-0.5 dark:border-zinc-700">
          {([['section', '섹션'], ['project', '프로젝트']] as const).map(([g, label]) => (
            <button key={g} onClick={() => setGroupByP(g)}
              className={`rounded px-2 py-0.5 text-[13px] font-semibold ${groupBy === g ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-50' : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* 데스크탑 인라인 캡처 (모바일은 FAB) */}
      <div className="mb-4 hidden items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-1 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20 md:flex dark:border-zinc-700 dark:bg-zinc-900">
        <Plus size={15} className="shrink-0 text-zinc-400" />
        <input
          data-capture
          className="h-9 flex-1 bg-transparent text-[14.5px] outline-none placeholder:text-zinc-400"
          placeholder="오늘 할 일을 입력 — Enter"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && submit()}
        />
      </div>

      {/* 오늘 일정(구글캘린더) — 데스크탑만 */}
      <div className="hidden md:block">
        <TodayEvents />
      </div>

      {/* Overdue */}
      {overdue.length > 0 && (
        <section className="mb-2">
          <div className="mt-1 mb-1.5 flex items-baseline gap-2 px-1.5">
            <span className="text-[14px] font-bold tracking-tight">Overdue</span>
            <span className="text-[12.5px] font-semibold text-zinc-400">{overdue.length}</span>
            <button
              className="ml-auto rounded px-1.5 py-0.5 text-[12px] font-semibold text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400"
              onClick={() => overdue.forEach(t => updateTask(t.id, { scheduled_date: todayStr() }))}
            >
              모두 오늘로
            </button>
          </div>
          {overdue.map(t => (
            <TaskRow key={t.id} task={t} onOpen={openDetail}
              trailing={<span className="shrink-0 text-[12px] font-semibold text-amber-600 dark:text-amber-400">d+{-daysFromToday(t.scheduled_date!)}</span>}
            />
          ))}
        </section>
      )}

      {/* To-dos (섹션별) / Done */}
      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        {groupBy === 'section' ? (
          <>
            <GroupLabel label="To-dos" count={todoCount} />
            <Section secKey={NONE} name="" tasks={(bySec[NONE] ?? []).filter(t => t.status !== 'done')} onOpen={openDetail} isFirst isLast hideHeader />
            {sorted.map((s, i) => (
              <Section key={s.id} secKey={s.id} name={s.name}
                tasks={(bySec[s.id] ?? []).filter(t => t.status !== 'done')}
                onOpen={openDetail} isFirst={i === 0} isLast={i === sorted.length - 1} />
            ))}
            <AddSectionBtn onAdd={addSectionPrompt} />
          </>
        ) : (
          <div className="mb-2">
            {wsGroups.noWs.length > 0 && (
              <div className="mb-3">
                {wsGroups.groups.length > 0 && <WsHeader label="미분류" />}
                {wsGroups.noWs.map(t => <TaskRow key={t.id} task={t} onOpen={openDetail} />)}
              </div>
            )}
            {wsGroups.groups.map(({ ws, subs, noProj }) => (
              <div key={ws.id} className="mb-3">
                <WsHeader label={ws.name} />
                {subs.map(s => (
                  <div key={s.project.id} className="mb-1.5">
                    <SubLabel label={s.project.title} />
                    {s.tasks.map(t => <TaskRow key={t.id} task={t} onOpen={openDetail} />)}
                  </div>
                ))}
                {noProj.length > 0 && (
                  <div className="mb-1.5">
                    {subs.length > 0 && <SubLabel label="서브프로젝트 없음" muted />}
                    {noProj.map(t => <TaskRow key={t.id} task={t} onOpen={openDetail} />)}
                  </div>
                )}
              </div>
            ))}
            {wsGroups.noWs.length === 0 && wsGroups.groups.length === 0 && (
              <p className="px-2 py-3 text-[13.5px] text-zinc-400">오늘 할 일이 없습니다</p>
            )}
          </div>
        )}
        {doneToday.length > 0 && (
          <section className="mt-5">
            <GroupLabel label="Done" count={doneCount} />
            {doneToday.map(t => <TaskRow key={t.id} task={t} onOpen={openDetail} />)}
          </section>
        )}
        <DragOverlay>
          {activeTask ? (
            <div className="rounded-md border border-blue-300 bg-white px-3 py-2 text-[14px] shadow-lg dark:border-blue-700 dark:bg-zinc-800">
              {activeTask.title}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {todayTasks.length === 0 && overdue.length === 0 && (
        <div className="mt-3 rounded-lg border border-dashed border-zinc-300 p-10 text-center text-[14px] text-zinc-400 dark:border-zinc-700">
          오늘 예정된 태스크가 없습니다
        </div>
      )}
    </div>
  )
}

/* ───── 오늘 일정 카드 (구글캘린더, 공유 스토어) ───── */
function TodayEvents() {
  const gcal = useGcal()
  const today = todayStr()

  useEffect(() => {
    void gcal.init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (gcal.status === 'connected') void gcal.ensureRange(today, toStr(addDays(new Date(), 1)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gcal.status])

  if (gcal.status === 'disabled') return null
  const events = gcal.eventsOn(today)

  return (
    <section className="mb-4 rounded-lg border border-zinc-200 bg-white p-2.5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-1 flex items-center gap-1.5 px-1">
        <CalendarDays size={13.5} className="text-zinc-400" />
        <span className="text-[13px] font-bold text-zinc-500 dark:text-zinc-400">오늘 일정</span>
        {gcal.status === 'connected' && (
          <button className="ml-auto rounded p-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200" onClick={() => void gcal.refresh()} title="새로고침">
            <RefreshCw size={13} />
          </button>
        )}
      </div>

      {gcal.status === 'disconnected' && (
        <div className="flex flex-wrap items-center gap-2 px-1 py-1">
          <CalendarX2 size={15} className="text-zinc-300 dark:text-zinc-600" />
          <span className="text-[13px] text-zinc-400">캘린더 연결이 만료되었거나 아직 연결 전입니다.</span>
          <button className="btn btn-primary !py-1 !text-[13px]" onClick={() => void gcal.connect()}>구글캘린더 연결</button>
          {gcal.errDetail && <span className="w-full text-[11.5px] break-all text-red-400">{gcal.errDetail}</span>}
        </div>
      )}
      {gcal.status === 'api_disabled' && (
        <p className="px-1 py-1 text-[13px] text-amber-600 dark:text-amber-400">
          Google Calendar API가 사용 설정되지 않았습니다 —{' '}
          <a className="underline" href="https://console.cloud.google.com/apis/library/calendar-json.googleapis.com" target="_blank" rel="noreferrer">활성화</a> 후 새로고침.
        </p>
      )}
      {gcal.status === 'error' && (
        <p className="px-1 py-1 text-[13px] text-red-500">일정을 불러오지 못했습니다. {gcal.errDetail}</p>
      )}
      {gcal.status === 'loading' && <p className="px-1 py-1 text-[13px] text-zinc-400">불러오는 중…</p>}
      {gcal.status === 'connected' && (
        events.length === 0
          ? <p className="px-1 py-1 text-[13px] text-zinc-400">오늘 일정이 없습니다. <Link to="/settings" className="underline">캘린더 선택</Link></p>
          : (
            <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
              {events.map(ev => (
                <div key={ev.id} className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-zinc-50 dark:hover:bg-zinc-800/60">
                  <span className="h-2 w-2 shrink-0 rounded-[3px]" style={{ background: ev.color ?? '#3b82f6' }} />
                  <span className="w-[84px] shrink-0 text-[12.5px] font-semibold text-zinc-400">
                    {ev.allDay ? '종일' : `${ev.start.slice(11, 16)}–${ev.end.slice(11, 16)}`}
                  </span>
                  <span className="truncate text-[13.5px] font-medium">{ev.summary}</span>
                </div>
              ))}
            </div>
          )
      )}
    </section>
  )
}

/** Overdue / To-dos / Done 상단 구분 라벨 */
function GroupLabel({ label, count }: { label: string; count: number }) {
  return (
    <div className="mt-1 mb-1.5 flex items-baseline gap-2 px-1.5">
      <span className="text-[14px] font-bold tracking-tight">{label}</span>
      <span className="text-[12.5px] font-semibold text-zinc-400">{count}</span>
    </div>
  )
}

/** 섹션 추가 (본문 인라인) */
function AddSectionBtn({ onAdd }: { onAdd: () => void }) {
  return (
    <button onClick={onAdd} className="mt-1 mb-3 ml-1.5 flex items-center gap-1 rounded px-1.5 py-0.5 text-[13px] font-medium text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400">
      <Plus size={13} /> 섹션 추가
    </button>
  )
}

/** 프로젝트 그룹 헤더 (워크스페이스=프로젝트) */
function WsHeader({ label }: { label: string }) {
  return (
    <div className="mb-1 flex items-center gap-2 border-b border-zinc-200 px-2 pb-1 dark:border-zinc-800">
      <Folder size={14} className="shrink-0 text-zinc-400" />
      <span className="text-[14.5px] font-bold tracking-tight text-zinc-700 dark:text-zinc-200">{label}</span>
    </div>
  )
}

/** 서브프로젝트 소제목 (들여쓰기) */
function SubLabel({ label, muted }: { label: string; muted?: boolean }) {
  return (
    <div className="mt-0.5 mb-0.5 pl-4">
      <span className={`text-[12.5px] font-semibold ${muted ? 'text-zinc-400' : 'text-zinc-500 dark:text-zinc-300'}`}>{label}</span>
    </div>
  )
}

/** 시간대 섹션 — 드롭존 + 정렬. 커스텀 섹션은 헤더에서 이동·이름변경·삭제. */
function Section({
  secKey, name, tasks, onOpen, isFirst, isLast, hideHeader,
}: {
  secKey: string
  name: string
  tasks: Task[]
  onOpen: (id: string) => void
  isFirst: boolean
  isLast: boolean
  hideHeader?: boolean
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `sec:${secKey}` })
  const renameSection = useStore(s => s.renameSection)
  const deleteSection = useStore(s => s.deleteSection)
  const moveSection = useStore(s => s.moveSection)
  const custom = secKey !== NONE

  return (
    <section
      ref={setNodeRef}
      className={`mb-3 rounded-lg border p-1.5 transition-colors ${
        isOver ? 'border-blue-400 bg-blue-50/40 dark:border-blue-600 dark:bg-blue-950/20' : 'border-transparent'
      }`}
    >
      {!hideHeader && (
        <div className="group mb-1 flex items-center gap-2 border-b border-zinc-200 px-2 pb-1 dark:border-zinc-800">
          <span className="h-3.5 w-1 shrink-0 rounded-full bg-blue-500/70" />
          <span className="text-[14.5px] font-bold tracking-tight text-zinc-700 dark:text-zinc-200">{name}</span>
          <span className="text-[12.5px] font-semibold text-zinc-400">{tasks.length || ''}</span>
          {custom && (
            <span className="invisible flex items-center gap-0.5 text-zinc-400 group-hover:visible">
              <button className="rounded p-0.5 hover:text-zinc-700 dark:hover:text-zinc-200" title="위로" disabled={isFirst}
                onClick={() => moveSection(secKey, -1)}><ChevronUp size={12.5} /></button>
              <button className="rounded p-0.5 hover:text-zinc-700 dark:hover:text-zinc-200" title="아래로" disabled={isLast}
                onClick={() => moveSection(secKey, 1)}><ChevronDown size={12.5} /></button>
              <button className="rounded p-0.5 hover:text-zinc-700 dark:hover:text-zinc-200" title="이름 변경"
                onClick={async () => {
                  const v = await promptDialog({ title: '섹션 이름 변경', defaultValue: name, confirmLabel: '변경' })
                  if (v?.trim()) renameSection(secKey, v.trim())
                }}><Pencil size={12} /></button>
              <button className="rounded p-0.5 hover:text-red-600" title="섹션 삭제 (태스크는 미지정으로)"
                onClick={async () => {
                  if (await confirmDialog({ title: '섹션 삭제', message: `"${name}" 섹션을 삭제할까요? 배정된 태스크는 미지정으로 이동합니다.`, confirmLabel: '삭제', danger: true })) deleteSection(secKey)
                }}><Trash2 size={12} /></button>
            </span>
          )}
        </div>
      )}
      <SortableContext items={tasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
        <div className="min-h-[8px]">
          {tasks.map(t => <SortableRow key={t.id} task={t} onOpen={onOpen} />)}
        </div>
      </SortableContext>
    </section>
  )
}

function SortableRow({ task, onOpen }: { task: Task; onOpen: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      className={isDragging ? 'opacity-40' : ''}
    >
      <TaskRow task={task} onOpen={onOpen} />
    </div>
  )
}
