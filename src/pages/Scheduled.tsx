import { useEffect, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useStore, selScheduled, selOverdue, useNavOrder } from '../store/store'
import { useGcal } from '../store/gcalStore'
import { fmtDate, daysFromToday, todayStr, toStr } from '../lib/dates'
import { addDays } from 'date-fns'
import TaskRow from '../components/TaskRow'
import { AlarmClockOff, CalendarDays } from 'lucide-react'
import type { Task } from '../types'
import type { GcalEvent } from '../lib/gcal'

const RANGE_DAYS = 60

export default function ScheduledPage() {
  const scheduled = useStore(useShallow(selScheduled))
  const overdue = useStore(useShallow(selOverdue))
  const updateTask = useStore(s => s.updateTask)
  const openDetail = useStore(s => s.openDetail)
  const gcal = useGcal()

  useEffect(() => {
    void gcal.init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (gcal.status === 'connected')
      void gcal.ensureRange(toStr(addDays(new Date(), 1)), toStr(addDays(new Date(), RANGE_DAYS)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gcal.status])

  const groups = useMemo(() => {
    const map = new Map<string, { tasks: Task[]; events: GcalEvent[] }>()
    const ensure = (d: string) => {
      if (!map.has(d)) map.set(d, { tasks: [], events: [] })
      return map.get(d)!
    }
    for (const t of scheduled) ensure(t.scheduled_date!).tasks.push(t)
    if (gcal.status === 'connected') {
      const today = todayStr()
      const max = toStr(addDays(new Date(), RANGE_DAYS))
      for (const e of gcal.events) {
        if (e.date > today && e.date <= max && (gcal.selected === null || gcal.selected.includes(e.calendarId)))
          ensure(e.date).events.push(e)
      }
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [scheduled, gcal.events, gcal.status, gcal.selected])

  // 키보드 내비: 지연 → 날짜 그룹의 태스크 순서대로 (일정은 제외)
  useNavOrder(useMemo(
    () => [...overdue.map(t => t.id), ...groups.flatMap(([, g]) => g.tasks.map(t => t.id))],
    [overdue, groups],
  ))

  return (
    <div className="mx-auto max-w-[760px] px-5 py-5">
      <div className="mb-4 flex items-baseline gap-3">
        <h1 className="text-[19px] font-bold tracking-tight">Scheduled</h1>
        <span className="text-[13.5px] font-medium text-zinc-400">{scheduled.length}건 예정</span>
      </div>

      {overdue.length > 0 && (
        <section className="mb-5">
          <div className="mb-1 flex items-center gap-1.5 px-1">
            <AlarmClockOff size={13} className="text-red-500" />
            <span className="text-[13px] font-bold text-red-600 dark:text-red-400">지연</span>
            <button
              className="ml-auto rounded px-1.5 py-0.5 text-[12.5px] font-semibold text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
              onClick={() => overdue.forEach(t => updateTask(t.id, { scheduled_date: todayStr() }))}
            >
              모두 오늘로 이동
            </button>
          </div>
          {overdue.map(t => <TaskRow key={t.id} task={t} onOpen={openDetail} showDate />)}
        </section>
      )}

      {groups.map(([date, { tasks, events }]) => {
        const d = daysFromToday(date)
        return (
          <section key={date} className="mb-5">
            <div className="mb-1 flex items-baseline gap-2 px-1">
              <span className="text-[13.5px] font-bold">{fmtDate(date)}</span>
              <span className="text-[12.5px] font-medium text-zinc-400">{d === 1 ? '내일' : `${d}일 후`}</span>
            </div>
            {events.map(ev => (
              <div key={ev.id} className="flex min-h-[30px] items-center gap-2.5 rounded-md px-2 py-1">
                <CalendarDays size={13} className="shrink-0 text-zinc-300 dark:text-zinc-600" />
                <span className="h-2 w-2 shrink-0 rounded-[3px]" style={{ background: ev.color ?? '#3b82f6' }} />
                <span className="w-[84px] shrink-0 text-[12.5px] font-semibold text-zinc-400">
                  {ev.allDay ? '종일' : `${ev.start.slice(11, 16)}–${ev.end.slice(11, 16)}`}
                </span>
                <span className="truncate text-[13.5px] text-zinc-500 dark:text-zinc-400">{ev.summary}</span>
              </div>
            ))}
            {tasks.map(t => <TaskRow key={t.id} task={t} onOpen={openDetail} />)}
          </section>
        )
      })}

      {groups.length === 0 && overdue.length === 0 && (
        <div className="rounded-lg border border-dashed border-zinc-300 p-10 text-center text-[14px] text-zinc-400 dark:border-zinc-700">
          예정된 태스크가 없습니다
        </div>
      )}
    </div>
  )
}
