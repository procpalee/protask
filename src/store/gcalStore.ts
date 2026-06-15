import { create } from 'zustand'
import {
  connect as gcalConnect, disconnect as gcalDisconnect, fetchCalendars, fetchEventsRange,
  rescheduleEvent, createEvent as gcalCreate, updateEvent as gcalUpdate, deleteEvent as gcalDelete,
  eventDays, gcalEnabled, hasValidToken, type GcalCalendar, type GcalEvent, type EventTiming,
} from '../lib/gcal'

/** YYYY-MM-DD에 n일 (정오 기준 tz 경계 회피) — 종일 end 배타 변환용 */
function addDay(d: string, n: number) {
  const dt = new Date(`${d}T12:00:00`)
  dt.setDate(dt.getDate() + n)
  const m = String(dt.getMonth() + 1).padStart(2, '0')
  const day = String(dt.getDate()).padStart(2, '0')
  return `${dt.getFullYear()}-${m}-${day}`
}

export type GcalStatus = 'disabled' | 'loading' | 'connected' | 'disconnected' | 'api_disabled' | 'error'

const LS_SEL = 'pd-gcal-selected'

/** 하단 토스트(App의 pd:flash 리스너) */
function flash(msg: string) {
  try { window.dispatchEvent(new CustomEvent('pd:flash', { detail: msg })) } catch { /* ignore */ }
}

function loadSelected(): string[] | null {
  try {
    const raw = localStorage.getItem(LS_SEL)
    return raw ? (JSON.parse(raw) as string[]) : null
  } catch {
    return null
  }
}

interface GcalStore {
  status: GcalStatus
  errDetail: string
  calendars: GcalCalendar[]
  /** null = 전체 표시, 배열 = 해당 캘린더만 */
  selected: string[] | null
  events: GcalEvent[]
  loadedKeys: string[]

  init: () => Promise<void>
  connect: () => Promise<void>
  disconnect: () => void
  /** [fromDate, toDate) — YYYY-MM-DD. 이미 로드한 범위는 스킵 */
  ensureRange: (fromDate: string, toDate: string) => Promise<void>
  refresh: () => Promise<void>
  /** 일정을 다른 날짜로 이동(구글에 쓰기). 낙관적 갱신 후 실패 시 롤백 */
  reschedule: (ev: GcalEvent, newDate: string) => Promise<void>
  /** 쓰기 가능한 캘린더(owner/writer) — 생성 대상 선택지 */
  writableCalendars: () => GcalCalendar[]
  /** 일정 생성. 성공 true */
  createEvent: (cal: GcalCalendar, summary: string, timing: EventTiming) => Promise<boolean>
  /** 일정 수정(제목·시간·날짜). 성공 true */
  updateEvent: (ev: GcalEvent, patch: { summary?: string; timing?: EventTiming }) => Promise<boolean>
  /** 일정 삭제. 성공 true */
  deleteEvent: (ev: GcalEvent) => Promise<boolean>
  setSelected: (ids: string[] | null) => void
  /** 선택 필터 적용된 특정 날짜 일정 */
  eventsOn: (date: string) => GcalEvent[]
}

let initOnce = false

export const useGcal = create<GcalStore>((set, get) => ({
  status: gcalEnabled ? (hasValidToken() ? 'loading' : 'disconnected') : 'disabled',
  errDetail: '',
  calendars: [],
  selected: loadSelected(),
  events: [],
  loadedKeys: [],

  init: async () => {
    if (!gcalEnabled || initOnce) return
    initOnce = true
    if (!hasValidToken()) {
      set({ status: 'disconnected' })
      return
    }
    const r = await fetchCalendars()
    if (r.ok) set({ calendars: r.calendars, status: 'connected' })
    else set({ status: r.reason === 'auth' ? 'disconnected' : r.reason, errDetail: r.detail ?? '' })
  },

  connect: async () => {
    if (!(await gcalConnect())) return
    const r = await fetchCalendars()
    if (r.ok) set({ calendars: r.calendars, status: 'connected', events: [], loadedKeys: [] })
    else set({ status: r.reason === 'auth' ? 'disconnected' : r.reason, errDetail: r.detail ?? '' })
  },

  disconnect: () => {
    gcalDisconnect()
    get().setSelected(null) // 다른 계정 재연결 시 옛 캘린더 필터가 새 캘린더를 가리지 않도록
    set({ status: 'disconnected', events: [], loadedKeys: [], calendars: [] })
  },

  ensureRange: async (fromDate, toDate) => {
    const s = get()
    if (s.status !== 'connected' || !s.calendars.length) return
    const key = `${fromDate}..${toDate}`
    if (s.loadedKeys.includes(key)) return
    set({ loadedKeys: [...s.loadedKeys, key] })
    // 로컬 자정 → UTC instant (브라우저 타임존 기준 경계, KST 하드코딩 제거)
    const r = await fetchEventsRange(new Date(`${fromDate}T00:00:00`).toISOString(), new Date(`${toDate}T00:00:00`).toISOString(), s.calendars)
    if (!r.ok) {
      set({
        status: r.reason === 'auth' ? 'disconnected' : r.reason,
        errDetail: r.detail ?? '',
        loadedKeys: get().loadedKeys.filter(k => k !== key),
      })
      return
    }
    const cur = get().events
    const ids = new Set(cur.map(e => e.id))
    set({ events: [...cur, ...r.events.filter(e => !ids.has(e.id))] })
  },

  refresh: async () => {
    const keys = get().loadedKeys
    set({ events: [], loadedKeys: [] })
    for (const key of keys) {
      const [from, to] = key.split('..')
      await get().ensureRange(from, to)
    }
  },

  reschedule: async (ev, newDate) => {
    if (ev.date === newDate) return
    const prev = get().events
    const delta = Math.round((Date.parse(`${newDate}T12:00:00`) - Date.parse(`${ev.date}T12:00:00`)) / 86400000)
    // 낙관적: 날짜 + (시간일정이면) start/end도 평행 이동해 표시 일관성 유지
    set({
      events: prev.map(e => {
        if (e.id !== ev.id) return e
        if (e.allDay) {
          const span = Math.max(1, Math.round((Date.parse(e.end) - Date.parse(e.start)) / 86400000))
          return { ...e, date: newDate, start: newDate, end: addDay(newDate, span) } // 종일 기간 유지
        }
        return {
          ...e,
          date: newDate,
          start: new Date(Date.parse(e.start) + delta * 86400000).toISOString(),
          end: new Date(Date.parse(e.end) + delta * 86400000).toISOString(),
        }
      }),
    })
    const r = await rescheduleEvent(ev, newDate)
    if (!r.ok) {
      set({
        events: prev, // 롤백
        status: r.reason === 'auth' ? 'disconnected' : r.reason === 'api_disabled' ? 'api_disabled' : get().status,
        errDetail: r.detail ?? '',
      })
      flash(r.reason === 'auth' ? '구글 캘린더 연결이 만료됨 — 설정에서 재연결' : '일정 이동 실패 — 설정에서 재연결(쓰기 권한) 후 다시 시도')
    }
  },

  writableCalendars: () => get().calendars.filter(c => c.accessRole === 'owner' || c.accessRole === 'writer'),

  createEvent: async (cal, summary, timing) => {
    const r = await gcalCreate(cal, summary, timing)
    if (!r.ok) {
      set({ errDetail: r.detail ?? '' })
      flash(r.reason === 'auth' ? '구글 캘린더 연결 만료 — 설정에서 재연결' : '일정 생성 실패 — 설정에서 재연결(쓰기 권한) 후 다시 시도')
      return false
    }
    set({ events: [...get().events.filter(e => e.id !== r.event.id), r.event] })
    return true
  },

  updateEvent: async (ev, patch) => {
    const prev = get().events
    const patched: GcalEvent = { ...ev }
    if (patch.summary !== undefined) patched.summary = patch.summary || '(제목 없음)'
    if (patch.timing) {
      const t = patch.timing
      patched.allDay = t.allDay
      patched.date = t.startDate
      if (t.allDay) {
        patched.start = t.startDate
        patched.end = addDay(t.endDate || t.startDate, 1) // 종일 end는 배타(+1)
      } else {
        patched.start = `${t.startDate}T${t.startTime || '09:00'}:00`
        patched.end = `${t.endDate || t.startDate}T${t.endTime || t.startTime || '09:00'}:00`
      }
    }
    set({ events: prev.map(e => (e.id === ev.id ? patched : e)) })
    const r = await gcalUpdate(ev, patch)
    if (!r.ok) {
      set({ events: prev, errDetail: r.detail ?? '' })
      flash(r.reason === 'auth' ? '구글 캘린더 연결 만료 — 설정에서 재연결' : '일정 수정 실패 — 권한/재연결 확인')
      return false
    }
    return true
  },

  deleteEvent: async ev => {
    const prev = get().events
    set({ events: prev.filter(e => e.id !== ev.id) })
    const r = await gcalDelete(ev.calendarId, ev.id)
    if (!r.ok) {
      set({ events: prev, errDetail: r.detail ?? '' })
      flash(r.reason === 'auth' ? '구글 캘린더 연결 만료 — 설정에서 재연결' : '일정 삭제 실패 — 권한/재연결 확인')
      return false
    }
    return true
  },

  setSelected: ids => {
    try {
      if (ids === null) localStorage.removeItem(LS_SEL)
      else localStorage.setItem(LS_SEL, JSON.stringify(ids))
    } catch { /* ignore */ }
    set({ selected: ids })
  },

  eventsOn: date => {
    const { events, selected } = get()
    return events
      .filter(e => (selected === null || selected.includes(e.calendarId)) && eventDays(e).includes(date))
      .sort((a, b) => Number(a.allDay ? 0 : 1) - Number(b.allDay ? 0 : 1) || a.start.localeCompare(b.start))
  },
}))
