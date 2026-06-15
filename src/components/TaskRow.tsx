import { useEffect, useRef, useState } from 'react'
import { Circle, CheckCircle2, CalendarDays, FolderInput, CloudMoon, Sun, Flag, Inbox, Star } from 'lucide-react'
import { addDays } from 'date-fns'
import type { Task, ChecklistItem } from '../types'
import { useStore } from '../store/store'
import ProjectChip from './ProjectChip'
import { daysFromToday, fmtDateShort, todayStr, toStr } from '../lib/dates'

/** GTD 리스트 공용 행: 완료 토글 + 제목 + 칩 + deadline 배지 + hover/키보드 퀵 액션 */
export default function TaskRow({
  task,
  onOpen,
  showDate,
  trailing,
}: {
  task: Task
  onOpen: (id: string) => void
  showDate?: boolean
  trailing?: React.ReactNode
}) {
  const toggleDone = useStore(s => s.toggleDone)
  const updateTask = useStore(s => s.updateTask)
  const selected = useStore(s => s.hoverTaskId === task.id)
  const done = task.status === 'done'
  const ref = useRef<HTMLDivElement>(null)

  // 키보드로 선택되면 화면 안으로 스크롤
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const ckTotal = countCk(task.checklist)
  const ckDone = countCk(task.checklist, true)

  return (
    <div>
      <div
        ref={ref}
        className={`group flex min-h-[36px] cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-zinc-100/80 dark:hover:bg-zinc-800/60 ${
          selected ? 'bg-zinc-100/80 ring-2 ring-blue-500/50 ring-inset dark:bg-zinc-800/60' : ''
        }`}
        onClick={() => onOpen(task.id)}
      >
        {/* 중요 토글 — 중요면 항상 노란 별, 아니면 hover/선택 시 토글 가능 */}
        <button
          className={`shrink-0 ${task.important ? 'text-amber-500' : 'invisible text-zinc-300 hover:text-amber-500 group-hover:visible dark:text-zinc-600'}`}
          onClick={e => { e.stopPropagation(); updateTask(task.id, { important: !task.important }) }}
          title={task.important ? '중요 해제' : '중요 표시'}
        >
          <Star size={14} className={task.important ? 'fill-current' : ''} />
        </button>

        <button
          className={`shrink-0 ${done ? 'text-emerald-500' : 'text-zinc-300 hover:text-emerald-500 dark:text-zinc-600'}`}
          onClick={e => {
            e.stopPropagation()
            toggleDone(task.id)
          }}
          title={done ? '완료 취소 (Space)' : '완료 (Space)'}
        >
          {done ? <CheckCircle2 size={17} /> : <Circle size={17} />}
        </button>

        <span className={`min-w-0 flex-1 truncate text-[14.5px] ${done ? 'text-zinc-400 line-through dark:text-zinc-500' : task.important ? 'font-semibold' : ''}`}>
          {task.title}
          {ckTotal > 0 && (
            <span className="ml-1.5 text-[12px] font-medium text-zinc-400">{ckDone}/{ckTotal}</span>
          )}
        </span>

        <QuickBar task={task} selected={selected} />

        {showDate && task.scheduled_date && (
          <span className="shrink-0 text-[12.5px] font-medium text-zinc-400">{fmtDateShort(task.scheduled_date)}</span>
        )}
        {task.deadline && !done && <DeadlineBadge deadline={task.deadline} />}
        <ProjectChip projectId={task.project_id} workspaceId={task.workspace_id} />
        {trailing}
      </div>

      {task.checklist.length > 0 && (
        <Subtasks items={task.checklist} onChange={next => updateTask(task.id, { checklist: next })} />
      )}
    </div>
  )
}

/* 서브태스크(체크리스트) — 태스크 밑에 들여써서 표시 + 체크 토글 */
function toggleCk(items: ChecklistItem[], id: string): ChecklistItem[] {
  return items.map(c => ({ ...c, done: c.id === id ? !c.done : c.done, children: toggleCk(c.children, id) }))
}
function Subtasks({ items, onChange }: { items: ChecklistItem[]; onChange: (next: ChecklistItem[]) => void }) {
  const render = (list: ChecklistItem[], depth: number): React.ReactNode =>
    list.map(c => (
      <div key={c.id}>
        <div
          className="flex items-start gap-1.5 py-[1px]"
          style={{ paddingLeft: 46 + depth * 16 }}
          onClick={e => e.stopPropagation()}
        >
          <input
            type="checkbox"
            checked={c.done}
            onChange={() => onChange(toggleCk(items, c.id))}
            className="mt-[3px] h-3 w-3 shrink-0 cursor-pointer accent-emerald-500"
          />
          <span className={`text-[13px] leading-[1.45] ${c.done ? 'text-zinc-400 line-through dark:text-zinc-500' : 'text-zinc-500 dark:text-zinc-400'}`}>
            {c.title}
          </span>
        </div>
        {render(c.children, depth + 1)}
      </div>
    ))
  return <div className="mb-1">{render(items, 0)}</div>
}

/** hover/키보드 선택 시 나타나는 즉시 편집 바: 오늘/내일 + 날짜·프로젝트 팝오버 */
function QuickBar({ task, selected }: { task: Task; selected?: boolean }) {
  const updateTask = useStore(s => s.updateTask)
  const projects = useStore(s => s.projects)
  const workspaces = useStore(s => s.workspaces)
  const qf = useStore(s => (s.hoverTaskId === task.id ? s.quickFocus : -1))
  const [pop, setPop] = useState<null | 'sched' | 'deadline' | 'proj'>(null)

  const qbtn = 'rounded px-1.5 py-0.5 text-[12px] font-semibold text-zinc-500 hover:bg-zinc-200 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-100'
  const on = 'bg-zinc-200 dark:bg-zinc-700'
  // 키보드 → 로 이동한 퀵액션 포커스 링 (Inbox·Today·Scheduled·Someday·Project·Deadline = 0~5)
  const foc = (i: number) => (qf === i ? ' ring-2 ring-blue-500 ring-inset bg-zinc-200 dark:bg-zinc-700' : '')

  return (
    <span
      className={`relative flex shrink-0 items-center gap-0.5 group-hover:visible ${selected ? 'visible' : 'invisible'}`}
      onClick={e => e.stopPropagation()}
      onMouseLeave={() => setPop(null)}
    >
      {/* 0) Inbox로 — 날짜·Someday 해제 (1) */}
      <button className={`${qbtn}${foc(0)}`} title="Inbox로 — 날짜·Someday 해제 (1)" onClick={() => updateTask(task.id, { scheduled_date: null, someday: false })}>
        <Inbox size={13} />
      </button>
      {/* 1) Today (2) */}
      <button className={`${qbtn}${foc(1)}`} title="오늘로 (2)" onClick={() => updateTask(task.id, { scheduled_date: todayStr() })}>
        <Sun size={13} />
      </button>
      {/* 2) Schedule — 실행일 날짜 (3) */}
      <button className={`${qbtn} ${pop === 'sched' ? on : ''}${foc(2)}`} title="실행일 날짜 선택 (3)" onClick={() => setPop(pop === 'sched' ? null : 'sched')}>
        <CalendarDays size={13} />
      </button>
      {/* 3) Someday (4) */}
      <button className={`${qbtn}${foc(3)}`} title={task.someday ? 'Someday 해제 (4)' : 'Someday — 언젠가 (4)'} onClick={() => updateTask(task.id, { someday: !task.someday })}>
        <CloudMoon size={13} className={task.someday ? 'text-violet-500 dark:text-violet-400' : ''} />
      </button>
      {/* 4) 프로젝트 선택 (5) */}
      <button className={`${qbtn} ${pop === 'proj' ? on : ''}${foc(4)}`} title="프로젝트 선택 (5)" onClick={() => setPop(pop === 'proj' ? null : 'proj')}>
        <FolderInput size={13} />
      </button>
      {/* 5) Deadline — 마감일 (6) */}
      <button className={`${qbtn} ${pop === 'deadline' ? on : ''} ${task.deadline ? 'text-red-500 dark:text-red-400' : ''}${foc(5)}`} title="마감일 (6)" onClick={() => setPop(pop === 'deadline' ? null : 'deadline')}>
        <Flag size={13} />
      </button>

      {pop === 'sched' && (
        <DatePop
          label="실행일"
          value={task.scheduled_date}
          quick
          onPick={d => { updateTask(task.id, { scheduled_date: d }); setPop(null) }}
        />
      )}
      {pop === 'deadline' && (
        <DatePop
          label="마감일"
          value={task.deadline}
          onPick={d => { updateTask(task.id, { deadline: d }); setPop(null) }}
        />
      )}
      {pop === 'proj' && (
        <div className="absolute top-6 right-0 z-30 w-[220px] rounded-lg border border-zinc-200 bg-white p-2 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
          <select
            autoFocus
            className="input !py-1 !text-[13px]"
            value={task.project_id ?? ''}
            onChange={e => {
              const pid = e.target.value || null
              const proj = pid ? projects.find(p => p.id === pid) : null
              updateTask(task.id, { project_id: pid, workspace_id: proj?.workspace_id ?? null })
              setPop(null)
            }}
          >
            <option value="">프로젝트 없음</option>
            {workspaces.map(w => (
              <optgroup key={w.id} label={w.name}>
                {projects.filter(p => p.workspace_id === w.id).map(p => (
                  <option key={p.id} value={p.id}>{p.title}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
      )}
    </span>
  )
}

function DatePop({ label, value, quick, onPick }: { label: string; value: string | null; quick?: boolean; onPick: (d: string | null) => void }) {
  return (
    <div className="absolute top-6 right-0 z-30 w-[190px] rounded-lg border border-zinc-200 bg-white p-2 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
      <div className="mb-1 px-0.5 text-[11.5px] font-semibold text-zinc-400">{label}</div>
      {quick && (
        <div className="mb-1.5 flex flex-wrap gap-1">
          <button className="btn !px-2 !py-0.5 !text-[12px]" onClick={() => onPick(todayStr())}>오늘</button>
          <button className="btn !px-2 !py-0.5 !text-[12px]" onClick={() => onPick(toStr(addDays(new Date(), 1)))}>내일</button>
          <button className="btn !px-2 !py-0.5 !text-[12px]" onClick={() => onPick(toStr(addDays(new Date(), 7)))}>+1주</button>
        </div>
      )}
      <input
        type="date"
        autoFocus
        className="input !py-1 !text-[13px]"
        value={value ?? ''}
        onChange={e => onPick(e.target.value || null)}
      />
      {value && (
        <button className="mt-1 w-full rounded px-2 py-0.5 text-left text-[12px] font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-950" onClick={() => onPick(null)}>
          날짜 지움
        </button>
      )}
    </div>
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

function countCk(items: { done: boolean; children: unknown[] }[], onlyDone = false): number {
  let n = 0
  for (const c of items) {
    if (!onlyDone || c.done) n++
    n += countCk(c.children as { done: boolean; children: unknown[] }[], onlyDone)
  }
  return n
}
