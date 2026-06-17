import { useEffect, useMemo, useState } from 'react'
import {
  DndContext, DragOverlay, PointerSensor, TouchSensor, closestCorners,
  useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  CalendarX2, RefreshCw, CalendarDays, Columns3, Rows3,
  Plus, Pencil, Trash2, ChevronUp, ChevronDown, Circle, CheckCircle2, Folder,
} from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useStore, selToday, selOverdue, useNavOrder, projectColor } from '../store/store'
import { promptDialog, confirmDialog } from '../store/dialogStore'
import { useGcal } from '../store/gcalStore'
import type { Task } from '../types'
import { between } from '../lib/position'
import { countCk } from '../lib/group'
import { fmtDate, todayStr, toStr, daysFromToday } from '../lib/dates'
import { useIsMobile } from '../lib/useIsMobile'
import { addDays } from 'date-fns'
import TaskRow, { DeadlineBadge } from '../components/TaskRow'
import ProjectChip from '../components/ProjectChip'
import { Link } from 'react-router-dom'

const NONE = 'none'

export default function TodayPage() {
  const todayTasks = useStore(useShallow(selToday))
  const overdue = useStore(useShallow(selOverdue))
  const sections = useStore(s => s.sections)
  const updateTask = useStore(s => s.updateTask)
  const rebalance = useStore(s => s.rebalance)
  const addSection = useStore(s => s.addSection)
  const addTask = useStore(s => s.addTask)
  const allTasks = useStore(s => s.tasks)
  const workspaces = useStore(s => s.workspaces)
  const projects = useStore(s => s.projects)
  const openDetail = useStore(s => s.openDetail)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [view, setView] = useState<'list' | 'board'>(() => (localStorage.getItem('pd-todayview') as 'list' | 'board') || 'list')
  const setViewP = (v: 'list' | 'board') => { setView(v); localStorage.setItem('pd-todayview', v) }
  const isMobile = useIsMobile()
  const effView = isMobile ? 'list' : view // 모바일은 리스트 뷰만
  type GroupBy = 'section' | 'wsproject'
  const [groupBy, setGroupBy] = useState<GroupBy>(() => (localStorage.getItem('pd-todaygroup') === 'wsproject' ? 'wsproject' : 'section'))
  const setGroupByP = (g: GroupBy) => { setGroupBy(g); localStorage.setItem('pd-todaygroup', g) }
  const addSectionPrompt = async () => { const name = await promptDialog({ title: '새 섹션', placeholder: '예: 아침, 오전, 집중시간', confirmLabel: '추가' }); if (name?.trim()) addSection(name.trim()) }

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

  // 워크스페이스 ▸ 프로젝트 그룹 (groupBy='wsproject') — 분류는 프로젝트까지만
  const wsGroups = useMemo(() => {
    const noWs = todayTasks.filter(t => !t.workspace_id)
    const byWs = new Map<string, Task[]>()
    for (const t of todayTasks) { if (!t.workspace_id) continue; if (!byWs.has(t.workspace_id)) byWs.set(t.workspace_id, []); byWs.get(t.workspace_id)!.push(t) }
    const groups = workspaces.filter(w => byWs.has(w.id)).map(w => {
      const wt = byWs.get(w.id)!
      const wp = projects.filter(p => p.workspace_id === w.id).sort((a, b) => a.position - b.position)
      const subs = wp.map(p => ({ project: p, tasks: wt.filter(t => t.project_id === p.id) })).filter(s => s.tasks.length)
      const noProj = wt.filter(t => !t.project_id || !wp.some(p => p.id === t.project_id))
      return { ws: w, subs, noProj }
    })
    return { noWs, groups }
  }, [todayTasks, workspaces, projects])

  // 보드 프로젝트 컬럼 (groupBy='wsproject' + 보드)
  const projColumns = useMemo(() => {
    const wsIndex = new Map(workspaces.map((w, i) => [w.id, i]))
    const withProj = projects
      .filter(p => todayTasks.some(t => t.project_id === p.id))
      .sort((a, b) => (wsIndex.get(a.workspace_id) ?? 0) - (wsIndex.get(b.workspace_id) ?? 0) || a.position - b.position)
      .map(p => ({ id: p.id, label: p.title, color: projectColor(p.id, projects), tasks: todayTasks.filter(t => t.project_id === p.id) }))
    const noProj = todayTasks.filter(t => !t.project_id)
    return noProj.length ? [{ id: '__noproj', label: '프로젝트 없음', color: '#71717a', tasks: noProj }, ...withProj] : withProj
  }, [todayTasks, projects, workspaces])

  // 키보드 내비 순서
  const todoOrder = useMemo(() => {
    if (groupBy === 'wsproject')
      return [...wsGroups.noWs, ...wsGroups.groups.flatMap(g => [...g.subs.flatMap(s => s.tasks), ...g.noProj])].map(t => t.id)
    return keys.flatMap(k => (bySec[k] ?? []).filter(t => t.status !== 'done').map(t => t.id))
  }, [groupBy, wsGroups, keys, bySec])
  useNavOrder(useMemo(() => {
    const base = [...overdue.map(t => t.id), ...todoOrder]
    if (groupBy === 'section') base.push(...todayTasks.filter(t => t.status === 'done').map(t => t.id))
    return [...new Set(base)]
  }, [overdue, todoOrder, groupBy, todayTasks]))

  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id))

  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null)
    const { active, over } = e
    if (!over) return
    const taskId = String(active.id)
    const task = allTasks.find(t => t.id === taskId)
    if (!task) return

    const overId = String(over.id)
    // 보드 프로젝트 컬럼에 드롭 → 프로젝트 배정 (분류 프로젝트까지)
    if (overId.startsWith('projcol:')) {
      const pid = overId.slice(8)
      if (pid === '__noproj') updateTask(taskId, { project_id: null })
      else {
        const proj = projects.find(p => p.id === pid)
        if (proj) updateTask(taskId, { project_id: proj.id, workspace_id: proj.workspace_id })
      }
      return
    }
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
      // 인접 위치 간격이 너무 좁음 → 새 순서로 섹션 전체 재배치(깨끗한 간격, 충돌 방지)
      const order = [...ids]
      order.splice(insertAt, 0, taskId)
      updateTask(taskId, { scheduled_date: todayStr(), today_section: sec === NONE ? null : sec })
      rebalance(order, 'today_position')
      return
    }
    updateTask(taskId, {
      scheduled_date: todayStr(),
      today_section: sec === NONE ? null : sec,
      today_position: pos,
    })
  }

  const activeTask = activeId ? allTasks.find(t => t.id === activeId) : null
  const doneToday = useMemo(() => todayTasks.filter(t => t.status === 'done'), [todayTasks])
  const doneCount = doneToday.length
  const todoCount = todayTasks.length - doneCount
  // 보드: 미지정 컬럼은 항목이 있을 때만
  const boardKeys = keys.filter(k => k !== NONE || (bySec[NONE]?.length ?? 0) > 0)

  return (
    <div className={`mx-auto px-5 py-5 ${effView === 'board' ? 'max-w-[1200px]' : 'max-w-[820px]'}`}>
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="text-[19px] font-bold tracking-tight">Today</h1>
        <span className="text-[13.5px] font-medium text-zinc-400">{fmtDate(todayStr())} · {doneCount}/{todayTasks.length} 완료</span>

        {/* 보기 각도: 섹션 / 프로젝트 (리스트·보드 공통) */}
        <div className="ml-auto flex items-center rounded-md border border-zinc-200 p-0.5 dark:border-zinc-700">
          {([['section', '섹션'], ['wsproject', '프로젝트']] as const).map(([g, label]) => (
            <button key={g}
              className={`rounded px-2 py-0.5 text-[13px] font-semibold ${groupBy === g ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-50' : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'}`}
              onClick={() => setGroupByP(g)}
            >{label}</button>
          ))}
        </div>

        <div className="hidden items-center rounded-md border border-zinc-200 p-0.5 md:flex dark:border-zinc-700">
          <button
            className={`flex items-center gap-1 rounded px-2 py-0.5 text-[13px] font-semibold ${view === 'list' ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-50' : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'}`}
            onClick={() => setViewP('list')} title="리스트"
          ><Rows3 size={13} /> 리스트</button>
          <button
            className={`flex items-center gap-1 rounded px-2 py-0.5 text-[13px] font-semibold ${view === 'board' ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-50' : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'}`}
            onClick={() => setViewP('board')} title="섹션 보드"
          ><Columns3 size={13} /> 보드</button>
        </div>
      </div>

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

      {/* 1) 오늘 일정 (구글캘린더) — 최상단. 모바일에선 캘린더 불필요 → 숨김 */}
      <div className="hidden md:block">
        <TodayEvents />
      </div>

      {/* 2) Overdue — 경과 일수만 우측에 d+N */}
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

      {/* 3) To-dos / Done — 리스트(기본) 또는 보드 */}
      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        {effView === 'board' ? (
          groupBy === 'wsproject' ? (
            <div className="flex flex-col gap-3 md:flex-row md:snap-x md:snap-mandatory md:overflow-x-auto md:pb-2">
              {projColumns.map(c => <ProjBoardColumn key={c.id} col={c} onOpen={openDetail} />)}
              {projColumns.length === 0 && <p className="px-2 py-3 text-[13.5px] text-zinc-400">오늘 할 일이 없습니다</p>}
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-3 md:flex-row md:snap-x md:snap-mandatory md:overflow-x-auto md:pb-2">
                {boardKeys.map((k, i) => (
                  <Section
                    key={k}
                    secKey={k}
                    name={k === NONE ? '' : sorted.find(s => s.id === k)?.name ?? k}
                    tasks={bySec[k] ?? []}
                    onOpen={openDetail}
                    isFirst={i === 0}
                    isLast={i === boardKeys.length - 1}
                    board
                    hideHeader={k === NONE}
                  />
                ))}
              </div>
              <AddSectionBtn onAdd={addSectionPrompt} />
            </>
          )
        ) : groupBy === 'section' ? (
          <>
            <GroupLabel label="To-dos" count={todoCount} />
            <Section secKey={NONE} name="" tasks={(bySec[NONE] ?? []).filter(t => t.status !== 'done')}
              onOpen={openDetail} isFirst isLast hideHeader />
            {sorted.map((s, i) => (
              <Section key={s.id} secKey={s.id} name={s.name}
                tasks={(bySec[s.id] ?? []).filter(t => t.status !== 'done')}
                onOpen={openDetail} isFirst={i === 0} isLast={i === sorted.length - 1} />
            ))}
            <AddSectionBtn onAdd={addSectionPrompt} />
            {doneToday.length > 0 && (
              <section className="mt-5">
                <GroupLabel label="Done" count={doneCount} />
                {doneToday.map(t => <TaskRow key={t.id} task={t} onOpen={openDetail} />)}
              </section>
            )}
          </>
        ) : (
          /* 프로젝트: 워크스페이스 ▸ 프로젝트까지만 */
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
                    {subs.length > 0 && <SubLabel label="프로젝트 없음" muted />}
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

/** 워크스페이스 아래 프로젝트 소제목 (들여쓰기) */
function SubLabel({ label, muted }: { label: string; muted?: boolean }) {
  return (
    <div className="mt-0.5 mb-0.5 pl-4">
      <span className={`text-[12.5px] font-semibold ${muted ? 'text-zinc-400' : 'text-zinc-500 dark:text-zinc-300'}`}>{label}</span>
    </div>
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

/** 섹션 추가 (헤더 대신 본문 인라인 — 보기 각도 전환 시 상단 패널이 움직이지 않게) */
function AddSectionBtn({ onAdd }: { onAdd: () => void }) {
  return (
    <button onClick={onAdd} className="mt-1 mb-3 ml-1.5 flex items-center gap-1 rounded px-1.5 py-0.5 text-[13px] font-medium text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400">
      <Plus size={13} /> 섹션 추가
    </button>
  )
}

/** 프로젝트 각도: 워크스페이스 헤더 (폴더 + 이름, 색상은 프로젝트에만) */
function WsHeader({ label }: { label: string }) {
  return (
    <div className="mb-0.5 flex items-baseline gap-1.5 px-1.5">
      <Folder size={13} className="shrink-0 self-center text-zinc-400" />
      <span className="text-[14px] font-bold tracking-tight">{label}</span>
    </div>
  )
}

/** 보드 프로젝트 컬럼 — 드롭 시 프로젝트 배정 */
function ProjBoardColumn({ col, onOpen }: { col: { id: string; label: string; color: string; tasks: Task[] }; onOpen: (id: string) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: `projcol:${col.id}` })
  return (
    <section
      ref={setNodeRef}
      className={`flex w-full shrink-0 flex-col rounded-lg border bg-zinc-100/60 p-1.5 transition-colors md:max-h-[70vh] md:w-[280px] md:snap-start dark:bg-zinc-900/50 ${
        isOver ? 'border-blue-400 !bg-blue-50/50 dark:border-blue-600 dark:!bg-blue-950/20' : 'border-zinc-200 dark:border-zinc-800'
      }`}
    >
      <div className="mb-0.5 flex items-center gap-1.5 px-2">
        <span className="h-2 w-2 shrink-0 rounded-[3px]" style={{ background: col.color }} />
        <span className="text-[13px] font-bold tracking-wide text-zinc-500 dark:text-zinc-300">{col.label}</span>
        <span className="text-[12px] font-semibold text-zinc-400">{col.tasks.length || ''}</span>
      </div>
      <div className="flex min-h-[60px] flex-1 flex-col gap-1.5 overflow-y-auto px-0.5">
        {col.tasks.map(t => <DraggableCard key={t.id} task={t} onOpen={onOpen} />)}
      </div>
    </section>
  )
}

function DraggableCard({ task, onOpen }: { task: Task; onOpen: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id })
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} className={isDragging ? 'opacity-40' : ''}>
      <BoardCard task={task} onOpen={onOpen} />
    </div>
  )
}

function Section({
  secKey, name, tasks, onOpen, isFirst, isLast, board, hideHeader,
}: {
  secKey: string
  name: string
  tasks: Task[]
  onOpen: (id: string) => void
  isFirst: boolean
  isLast: boolean
  board?: boolean
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
      className={
        board
          ? `flex w-full shrink-0 flex-col rounded-lg border bg-zinc-100/60 p-1.5 transition-colors md:max-h-[70vh] md:w-[280px] md:snap-start dark:bg-zinc-900/50 ${
              isOver ? 'border-blue-400 !bg-blue-50/50 dark:border-blue-600 dark:!bg-blue-950/20' : 'border-zinc-200 dark:border-zinc-800'
            }`
          : `mb-3 rounded-lg border p-1.5 transition-colors ${
              isOver ? 'border-blue-400 bg-blue-50/40 dark:border-blue-600 dark:bg-blue-950/20' : 'border-transparent'
            }`
      }
    >
      {!hideHeader && (
        <div className="group mb-0.5 flex items-center gap-1.5 px-2 text-zinc-400">
          <span className="text-[13px] font-bold tracking-wide">{name}</span>
          <span className="text-[12px] font-semibold">{tasks.length || ''}</span>
          {custom && (
            <span className="invisible flex items-center gap-0.5 group-hover:visible">
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
        <div className={board ? 'flex min-h-[60px] flex-1 flex-col gap-1.5 overflow-y-auto px-0.5' : 'min-h-[8px]'}>
          {tasks.map(t => <SortableRow key={t.id} task={t} onOpen={onOpen} board={board} />)}
        </div>
      </SortableContext>
    </section>
  )
}

function SortableRow({ task, onOpen, board }: { task: Task; onOpen: (id: string) => void; board?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      className={isDragging ? 'opacity-40' : ''}
    >
      {board ? <BoardCard task={task} onOpen={onOpen} /> : <TaskRow task={task} onOpen={onOpen} />}
    </div>
  )
}

/** 보드 컬럼용 컴팩트 카드 (좁은 폭에 맞춤 — QuickBar 없음) */
function BoardCard({ task, onOpen }: { task: Task; onOpen: (id: string) => void }) {
  const toggleDone = useStore(s => s.toggleDone)
  const done = task.status === 'done'
  const ckTotal = countCk(task.checklist)
  const ckDone = countCk(task.checklist, true)
  return (
    <div
      className={`cursor-pointer rounded-md border border-zinc-200 bg-white p-2.5 shadow-[0_1px_2px_rgb(0_0_0/0.04)] transition-colors hover:border-blue-400 dark:border-zinc-700 dark:bg-zinc-800/90 dark:hover:border-blue-600 ${done ? 'opacity-60' : ''}`}
      onClick={() => onOpen(task.id)}
    >
      <div className="flex items-start gap-2">
        <button
          className={`mt-px shrink-0 ${done ? 'text-emerald-500' : 'text-zinc-300 hover:text-emerald-500 dark:text-zinc-600'}`}
          onClick={e => { e.stopPropagation(); toggleDone(task.id) }}
          onPointerDown={e => e.stopPropagation()}
          title={done ? '완료 취소' : '완료'}
        >
          {done ? <CheckCircle2 size={16} /> : <Circle size={16} />}
        </button>
        <div className="min-w-0 flex-1">
          <div className={`text-[13.5px] leading-snug break-words ${done ? 'text-zinc-400 line-through' : ''}`}>{task.title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 empty:hidden">
            {ckTotal > 0 && <span className="text-[12px] font-medium text-zinc-400">{ckDone}/{ckTotal}</span>}
            {task.deadline && !done && <DeadlineBadge deadline={task.deadline} />}
            <ProjectChip projectId={task.project_id} workspaceId={task.workspace_id} />
          </div>
        </div>
      </div>
    </div>
  )
}
