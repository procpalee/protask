import { useEffect, useState } from 'react'
import { Trash2, X } from 'lucide-react'
import { useGcal } from '../store/gcalStore'
import type { EventTiming, GcalEvent } from '../lib/gcal'

/** YYYY-MM-DD에 n일 (정오 기준으로 tz 경계 회피) */
function shiftDate(d: string, n: number) {
  const dt = new Date(`${d}T12:00:00`)
  dt.setDate(dt.getDate() + n)
  const m = String(dt.getMonth() + 1).padStart(2, '0')
  const day = String(dt.getDate()).padStart(2, '0')
  return `${dt.getFullYear()}-${m}-${day}`
}

/** 구글 캘린더 일정 생성/편집 모달 */
export default function GcalEventModal({
  mode, event, initialDate, onClose,
}: {
  mode: 'create' | 'edit'
  event?: GcalEvent
  initialDate?: string
  onClose: () => void
}) {
  const calendars = useGcal(s => s.calendars)
  const writable = useGcal(s => s.writableCalendars)()
  const createEvent = useGcal(s => s.createEvent)
  const updateEvent = useGcal(s => s.updateEvent)
  const deleteEvent = useGcal(s => s.deleteEvent)

  const ev = event
  const init = () => {
    if (mode === 'edit' && ev) {
      if (ev.allDay) {
        return {
          title: ev.summary === '(제목 없음)' ? '' : ev.summary,
          allDay: true,
          startDate: ev.date,
          startTime: '09:00',
          endDate: shiftDate(ev.end || ev.start, -1) >= ev.date ? shiftDate(ev.end || ev.start, -1) : ev.date, // 종일 end는 배타 → -1
          endTime: '10:00',
          calId: ev.calendarId,
        }
      }
      return {
        title: ev.summary === '(제목 없음)' ? '' : ev.summary,
        allDay: false,
        startDate: ev.start.slice(0, 10),
        startTime: ev.start.slice(11, 16) || '09:00',
        endDate: (ev.end || ev.start).slice(0, 10),
        endTime: (ev.end || ev.start).slice(11, 16) || '10:00',
        calId: ev.calendarId,
      }
    }
    const d = initialDate ?? new Date().toISOString().slice(0, 10)
    const primary = writable.find(c => c.primary) ?? writable[0]
    return { title: '', allDay: false, startDate: d, startTime: '09:00', endDate: d, endTime: '10:00', calId: primary?.id ?? '' }
  }

  const [f, setF] = useState(init)
  const [busy, setBusy] = useState(false)
  const set = (p: Partial<ReturnType<typeof init>>) => setF(prev => ({ ...prev, ...p }))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const timing = (): EventTiming => {
    const endDate = f.endDate < f.startDate ? f.startDate : f.endDate
    // 같은 날 시간 일정에서 종료<시작이면 종료를 시작으로 보정 (Google 400 방지)
    let endTime = f.endTime
    if (!f.allDay && endDate === f.startDate && endTime < f.startTime) endTime = f.startTime
    return {
      allDay: f.allDay,
      startDate: f.startDate,
      startTime: f.allDay ? undefined : f.startTime,
      endDate,
      endTime: f.allDay ? undefined : endTime,
    }
  }

  const save = async () => {
    setBusy(true)
    let ok = false
    if (mode === 'create') {
      const cal = calendars.find(c => c.id === f.calId)
      if (cal) ok = await createEvent(cal, f.title.trim(), timing())
    } else if (ev) {
      ok = await updateEvent(ev, { summary: f.title.trim(), timing: timing() })
    }
    setBusy(false)
    if (ok) onClose()
  }

  const remove = async () => {
    if (!ev) return
    if (!window.confirm(`"${ev.summary}" 일정을 삭제할까요?`)) return
    setBusy(true)
    const ok = await deleteEvent(ev)
    setBusy(false)
    if (ok) onClose()
  }

  const noWritable = mode === 'create' && writable.length === 0

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 pt-[12vh] backdrop-blur-[1px]"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-[420px] overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
        <div className="flex items-center gap-2 border-b border-zinc-100 px-4 py-2.5 dark:border-zinc-800">
          <span className="text-[12px] font-semibold text-zinc-400">{mode === 'create' ? '새 일정' : '일정 편집'}</span>
          <div className="ml-auto flex items-center gap-1">
            {mode === 'edit' && (
              <button className="rounded p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950" title="삭제" onClick={() => void remove()} disabled={busy}>
                <Trash2 size={15} />
              </button>
            )}
            <button className="rounded p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800" onClick={onClose} title="닫기 (Esc)">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="space-y-3 px-5 py-4">
          <input
            autoFocus
            className="w-full bg-transparent text-[15px] font-semibold outline-none placeholder:text-zinc-400"
            value={f.title}
            onChange={e => set({ title: e.target.value })}
            onKeyDown={e => { if (e.key === 'Enter' && !busy) void save() }}
            placeholder="일정 제목"
          />

          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" className="h-3.5 w-3.5 accent-blue-600" checked={f.allDay} onChange={e => set({ allDay: e.target.checked })} />
            종일
          </label>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="w-10 text-[12px] text-zinc-400">시작</span>
              <input type="date" className="input !py-1 !text-[12px]" value={f.startDate} onChange={e => set({ startDate: e.target.value, endDate: f.endDate < e.target.value ? e.target.value : f.endDate })} />
              {!f.allDay && <input type="time" className="input !w-auto !py-1 !text-[12px]" value={f.startTime} onChange={e => set({ startTime: e.target.value })} />}
            </div>
            <div className="flex items-center gap-2">
              <span className="w-10 text-[12px] text-zinc-400">종료</span>
              <input type="date" className="input !py-1 !text-[12px]" value={f.endDate} min={f.startDate} onChange={e => set({ endDate: e.target.value })} />
              {!f.allDay && <input type="time" className="input !w-auto !py-1 !text-[12px]" value={f.endTime} onChange={e => set({ endTime: e.target.value })} />}
            </div>
          </div>

          {mode === 'create' ? (
            <div className="flex items-center gap-2">
              <span className="w-10 text-[12px] text-zinc-400">캘린더</span>
              <select className="input !py-1 !text-[12px]" value={f.calId} onChange={e => set({ calId: e.target.value })}>
                {writable.map(c => <option key={c.id} value={c.id}>{c.summary}</option>)}
              </select>
            </div>
          ) : (
            ev && <p className="text-[12px] text-zinc-400">캘린더: {ev.calendar ?? ev.calendarId}</p>
          )}

          {noWritable && <p className="text-[12px] text-amber-600 dark:text-amber-400">쓰기 가능한 캘린더가 없습니다. 설정에서 재연결(쓰기 권한)하세요.</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button className="btn" onClick={onClose} disabled={busy}>취소</button>
            <button className="btn btn-primary" onClick={() => void save()} disabled={busy || noWritable || !f.startDate}>
              {busy ? '저장 중…' : '저장'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
