import { useEffect } from 'react'
import { Sun, CalendarDays, CalendarClock, CalendarRange, Moon, CircleSlash, Flag } from 'lucide-react'
import { addDays } from 'date-fns'
import { useStore } from '../store/store'
import { todayStr, toStr, fmtDateShort, thisWeekEnd, nextWeekStart } from '../lib/dates'
import type { Task } from '../types'

/** Akiflow식 빠른 일정 팝업 — 오늘·내일·이번주·다음주·Someday·날짜없음 + 직접선택 + 마감일.
 *  부모의 relative 컨테이너 안에 렌더(absolute). 바깥 클릭/Esc로 닫힘. */
export default function PlanPopover({ task, onClose, align = 'right' }: { task: Task; onClose: () => void; align?: 'right' | 'left' }) {
  const updateTask = useStore(s => s.updateTask)
  const apply = (patch: Partial<Task>) => { updateTask(task.id, patch); onClose() }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const tomorrow = toStr(addDays(new Date(), 1))
  const opts: { icon: React.ReactNode; label: string; sub?: string; active: boolean; onClick: () => void }[] = [
    { icon: <Sun size={14} className="text-amber-500" />, label: '오늘', sub: fmtDateShort(todayStr()), active: task.scheduled_date === todayStr(), onClick: () => apply({ scheduled_date: todayStr(), someday: false }) },
    { icon: <CalendarDays size={14} className="text-blue-500" />, label: '내일', sub: fmtDateShort(tomorrow), active: task.scheduled_date === tomorrow, onClick: () => apply({ scheduled_date: tomorrow, someday: false }) },
    { icon: <CalendarClock size={14} className="text-indigo-500" />, label: '이번 주', sub: fmtDateShort(thisWeekEnd()), active: task.scheduled_date === thisWeekEnd(), onClick: () => apply({ scheduled_date: thisWeekEnd(), someday: false }) },
    { icon: <CalendarRange size={14} className="text-violet-500" />, label: '다음 주', sub: fmtDateShort(nextWeekStart()), active: task.scheduled_date === nextWeekStart(), onClick: () => apply({ scheduled_date: nextWeekStart(), someday: false }) },
    { icon: <Moon size={14} className="text-violet-400" />, label: 'Someday', active: !!task.someday, onClick: () => apply({ someday: true }) },
    { icon: <CircleSlash size={14} className="text-zinc-400" />, label: '날짜 없음', active: !task.scheduled_date && !task.someday, onClick: () => apply({ scheduled_date: null, someday: false }) },
  ]

  return (
    <>
      <div className="fixed inset-0 z-40" onMouseDown={onClose} />
      <div className={`absolute top-7 z-50 w-[208px] max-w-[calc(100vw-1.5rem)] rounded-lg border border-zinc-200 bg-white p-1 shadow-xl dark:border-zinc-700 dark:bg-zinc-900 ${align === 'right' ? 'right-0' : 'left-0'}`}>
        {opts.map(o => (
          <button
            key={o.label}
            className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-zinc-100 dark:hover:bg-zinc-800 ${o.active ? 'bg-zinc-100 font-semibold dark:bg-zinc-800' : ''}`}
            onClick={o.onClick}
          >
            {o.icon}
            <span className="flex-1">{o.label}</span>
            {o.sub && <span className="text-[11.5px] text-zinc-400">{o.sub}</span>}
          </button>
        ))}
        <div className="my-1 border-t border-zinc-100 dark:border-zinc-800" />
        <label className="flex items-center gap-2 px-2 py-1 text-[12px] text-zinc-500 dark:text-zinc-400">
          <CalendarDays size={13} className="shrink-0 text-zinc-400" />
          <input
            type="date"
            className="w-full bg-transparent text-[12.5px] outline-none"
            value={task.scheduled_date ?? ''}
            onChange={e => apply({ scheduled_date: e.target.value || null, someday: false })}
          />
        </label>
        <label className="flex items-center gap-2 px-2 py-1 text-[12px] text-zinc-500 dark:text-zinc-400" title="마감일">
          <Flag size={13} className={`shrink-0 ${task.deadline ? 'text-red-500' : 'text-zinc-400'}`} />
          <input
            type="date"
            className="w-full bg-transparent text-[12.5px] outline-none"
            value={task.deadline ?? ''}
            onChange={e => updateTask(task.id, { deadline: e.target.value || null })}
          />
        </label>
      </div>
    </>
  )
}
