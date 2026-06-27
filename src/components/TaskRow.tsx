import { useEffect, useRef, useState } from 'react'
import { Square, SquareCheckBig, CalendarDays, FolderInput, CircleSlash, Star } from 'lucide-react'
import { wsColor, type Task } from '../types'
import { useStore, projectColor } from '../store/store'
import ProjectChip from './ProjectChip'
import PlanPopover from './PlanPopover'
import { useTaskContextMenu } from './TaskContextMenu'
import { daysFromToday, fmtDateShort } from '../lib/dates'

/** GTD 리스트 공용 행: 완료 토글 + 제목 + 칩 + deadline 배지 + hover/키보드 퀵 액션 */
export default function TaskRow({
  task,
  onOpen,
  trailing,
}: {
  task: Task
  onOpen: (id: string) => void
  trailing?: React.ReactNode
}) {
  const toggleDone = useStore(s => s.toggleDone)
  const updateTask = useStore(s => s.updateTask)
  const selected = useStore(s => s.hoverTaskId === task.id)
  const done = task.status === 'done'
  const ref = useRef<HTMLDivElement>(null)
  const { onContextMenu, menu: ctxMenu } = useTaskContextMenu(task, onOpen)

  // 키보드로 선택되면 화면 안으로 스크롤
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  return (
    <div>
      <div
        ref={ref}
        className={`group flex min-h-[44px] cursor-pointer flex-wrap items-center gap-x-2 gap-y-1 rounded-md border-l-[3px] px-2 py-1.5 hover:bg-zinc-100/80 md:min-h-[36px] md:flex-nowrap dark:hover:bg-zinc-800/60 ${
          task.important && !done ? 'border-amber-400 bg-amber-50/50 dark:border-amber-500 dark:bg-amber-500/10' : 'border-transparent'
        } ${selected ? 'bg-zinc-100/80 ring-2 ring-blue-500/50 ring-inset dark:bg-zinc-800/60' : ''}`}
        onClick={() => onOpen(task.id)}
        onContextMenu={onContextMenu}
      >
        <button
          className={`shrink-0 ${done ? 'text-emerald-500' : 'text-zinc-300 hover:text-emerald-500 dark:text-zinc-600'}`}
          onClick={e => {
            e.stopPropagation()
            toggleDone(task.id)
          }}
          title={done ? '완료 취소 (Space)' : '완료 (Space)'}
        >
          {done ? <SquareCheckBig size={17} /> : <Square size={17} />}
        </button>

        <span className={`min-w-0 flex-1 truncate text-[14.5px] ${done ? 'text-zinc-400 line-through dark:text-zinc-500' : task.important ? 'font-semibold text-amber-700 dark:text-amber-300' : ''}`}>
          {task.title}
        </span>

        {/* 날짜·프로젝트 등 — 모바일에선 제목 아래 줄로 줄바꿈(들여쓰기) */}
        <div className="flex shrink-0 items-center gap-2 max-md:order-last max-md:basis-full max-md:pl-[46px]">
          {task.deadline && !done && <DeadlineBadge deadline={task.deadline} />}
          <ScheduleChip task={task} selected={selected} />
          <ProjectControl task={task} selected={selected} />
          {/* 중요 토글 — 중요면 항상 노란 별, 아니면 hover/선택 시 토글 가능 */}
          <button
            className={`shrink-0 ${task.important ? 'text-amber-500' : `text-zinc-300 hover:text-amber-500 group-hover:visible touch:visible dark:text-zinc-600 ${selected ? 'visible' : 'invisible'}`}`}
            onClick={e => { e.stopPropagation(); updateTask(task.id, { important: !task.important }) }}
            title={task.important ? '중요 해제' : '중요 표시'}
          >
            <Star size={14} className={task.important ? 'fill-current' : ''} />
          </button>
          {trailing}
        </div>
      </div>

      {ctxMenu}
    </div>
  )
}

/** 일정 칩 — 날짜 있으면 상대 라벨(클릭=재일정), Someday면 "Someday", 없으면 hover 시 "Plan". 클릭 → PlanPopover */
function ScheduleChip({ task, selected }: { task: Task; selected?: boolean }) {
  const [open, setOpen] = useState(false)
  const has = !!task.scheduled_date || task.someday

  let content: string
  let tone: 'overdue' | 'today' | 'future' | 'someday' | 'plan'
  if (task.scheduled_date) {
    const d = daysFromToday(task.scheduled_date)
    content = d === 0 ? '오늘' : d === 1 ? '내일' : fmtDateShort(task.scheduled_date)
    tone = d < 0 ? 'overdue' : d === 0 ? 'today' : 'future'
  } else if (task.someday) {
    content = 'Someday'; tone = 'someday'
  } else {
    content = 'Plan'; tone = 'plan'
  }

  // 모노톤 — 연체만 옅은 빨강으로 신호, 나머지는 중립 zinc
  const toneCls = {
    overdue: 'text-red-400 hover:bg-zinc-100 dark:text-red-400/90 dark:hover:bg-zinc-800',
    today: 'text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800',
    future: 'text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800',
    someday: 'text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800',
    plan: 'text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200',
  }[tone]
  // 날짜·Someday·Plan 모두 hover/선택 시에만 노출 (터치 기기에선 항상 노출)
  const vis = `group-hover:visible touch:visible ${selected ? 'visible' : 'invisible'}`

  return (
    <span className="relative shrink-0" onClick={e => e.stopPropagation()}>
      <button
        className={`flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] font-medium transition-colors ${toneCls} ${vis}`}
        title="일정 변경"
        onClick={() => setOpen(o => !o)}
      >
        {!has && <CalendarDays size={12} className="shrink-0" />}
        <span>{content}</span>
      </button>
      {open && <PlanPopover task={task} onClose={() => setOpen(false)} />}
    </span>
  )
}

/** 프로젝트 칩 — 있으면 ProjectChip(클릭=변경), 없으면 hover 시 "프로젝트". 클릭 → 프로젝트 선택 팝오버 */
function ProjectControl({ task, selected }: { task: Task; selected?: boolean }) {
  const [open, setOpen] = useState(false)
  const projects = useStore(s => s.projects)
  const workspaces = useStore(s => s.workspaces)
  const updateTask = useStore(s => s.updateTask)
  const has = !!task.project_id || !!task.workspace_id
  const vis = has ? '' : `group-hover:visible touch:visible ${selected ? 'visible' : 'invisible'}`

  return (
    <span className="relative shrink-0" onClick={e => e.stopPropagation()}>
      <button
        className={`flex shrink-0 items-center rounded-md ${has ? 'hover:opacity-80' : 'gap-1 px-1.5 py-0.5 text-[12px] font-medium text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200'} ${vis}`}
        title="프로젝트 변경"
        onClick={() => setOpen(o => !o)}
      >
        {has ? <ProjectChip projectId={task.project_id} workspaceId={task.workspace_id} /> : <><FolderInput size={12} className="shrink-0" />프로젝트</>}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onMouseDown={() => setOpen(false)} />
          <div className="absolute top-7 right-0 z-50 max-h-[320px] w-[220px] max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-lg border border-zinc-200 bg-white p-1 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
            <button
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-zinc-100 dark:hover:bg-zinc-800 ${!task.project_id ? 'bg-zinc-100 font-semibold dark:bg-zinc-800' : ''}`}
              onClick={() => { updateTask(task.id, { project_id: null, workspace_id: null }); setOpen(false) }}
            >
              <CircleSlash size={14} className="shrink-0 text-zinc-400" />
              <span className="flex-1">프로젝트 없음</span>
            </button>
            {workspaces.map(w => {
              const ps = projects.filter(p => p.workspace_id === w.id)
              const wsActive = task.workspace_id === w.id && !task.project_id
              return (
                <div key={w.id}>
                  <button
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] font-semibold hover:bg-zinc-100 dark:hover:bg-zinc-800 ${wsActive ? 'bg-zinc-100 dark:bg-zinc-800' : ''}`}
                    onClick={() => { updateTask(task.id, { workspace_id: w.id, project_id: null }); setOpen(false) }}
                  >
                    <span className="h-2.5 w-2.5 shrink-0 rounded-[4px]" style={{ background: wsColor(w.id, workspaces) }} />
                    <span className="flex-1 truncate">{w.name}</span>
                  </button>
                  {ps.map(p => (
                    <button
                      key={p.id}
                      className={`flex w-full items-center gap-2 rounded-md py-1.5 pr-2 pl-6 text-left text-[13px] hover:bg-zinc-100 dark:hover:bg-zinc-800 ${task.project_id === p.id ? 'bg-zinc-100 font-semibold dark:bg-zinc-800' : ''}`}
                      onClick={() => { updateTask(task.id, { project_id: p.id, workspace_id: w.id }); setOpen(false) }}
                    >
                      <span className="h-2 w-2 shrink-0 rounded-[3px]" style={{ background: projectColor(p.id, projects) }} />
                      <span className="flex-1 truncate">{p.title}</span>
                    </button>
                  ))}
                </div>
              )
            })}
          </div>
        </>
      )}
    </span>
  )
}

export function DeadlineBadge({ deadline }: { deadline: string }) {
  const d = daysFromToday(deadline)
  const cls =
    d < 0
      ? 'border-red-200 bg-red-50 text-red-600 dark:border-red-900 dark:bg-red-950 dark:text-red-400'
      : d <= 3
        ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400'
        : 'border-zinc-200 bg-zinc-50 text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800/70 dark:text-zinc-400'
  const label = d < 0 ? `마감 ${-d}일 지남` : d === 0 ? '오늘 마감' : `D-${d}`
  return (
    <span className={`shrink-0 rounded-full border px-1.5 py-px text-[12px] font-semibold ${cls}`} title={`마감일 ${deadline}`}>
      {label}
    </span>
  )
}
