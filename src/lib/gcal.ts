/**
 * Google Calendar read-only.
 * GIS code client(1회 동의) → Vercel 서버리스(/api/google-token)가 client_secret으로
 * code 교환·refresh — 이후 access token은 제스처 없이 자동 갱신(영구 연결).
 */

export const GCAL_CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? ''
export const gcalEnabled = !!GCAL_CLIENT_ID

export interface GcalCalendar {
  id: string
  summary: string
  color?: string
  primary?: boolean
}

export interface GcalEvent {
  id: string
  summary: string
  start: string // ISO datetime 또는 date
  end: string
  date: string // YYYY-MM-DD (표시 기준일 = 시작일)
  allDay: boolean
  color?: string
  calendarId: string
  calendar?: string
}

export type GcalFail = { ok: false; reason: 'auth' | 'api_disabled' | 'error'; detail?: string }

interface AuthInfo { token: string; expiresAt: number; refreshToken: string | null }

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initCodeClient: (cfg: {
            client_id: string
            scope: string
            ux_mode: 'popup'
            callback: (resp: { code?: string; error?: string }) => void
          }) => { requestCode: () => void }
        }
      }
    }
  }
}

/**
 * 토큰 프록시. 프로덕션은 동일 출처(상대경로). dev(localhost)는 서버리스가 없어
 * VITE_API_BASE(배포된 도메인)로 호출 — 미설정 시 구글 캘린더 비활성과 동일하게 동작.
 */
const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? ''
const TOKEN_API = `${location.hostname === 'localhost' ? API_BASE : ''}/api/google-token`
const LS_AUTH = 'pd-gcal-auth-v1'

let auth: AuthInfo | null = loadAuth()

function loadAuth(): AuthInfo | null {
  try {
    const raw = localStorage.getItem(LS_AUTH)
    if (raw) return JSON.parse(raw) as AuthInfo
    // 구버전(refresh 없는 토큰) 이전
    const legacy = localStorage.getItem('pd-gcal-token')
    if (legacy) {
      const t = JSON.parse(legacy) as { token: string; expiresAt: number }
      localStorage.removeItem('pd-gcal-token')
      const a = { ...t, refreshToken: null }
      localStorage.setItem(LS_AUTH, JSON.stringify(a))
      return a
    }
    return null
  } catch {
    return null
  }
}

function saveAuth(a: AuthInfo | null) {
  auth = a
  try {
    if (a) localStorage.setItem(LS_AUTH, JSON.stringify(a))
    else localStorage.removeItem(LS_AUTH)
  } catch { /* ignore */ }
}

/** 만료 시 refresh token으로 자동 갱신 (제스처 불필요) */
async function ensureToken(): Promise<boolean> {
  if (auth && auth.expiresAt > Date.now() + 60_000) return true
  if (auth?.refreshToken) {
    try {
      const r = await fetch(TOKEN_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'refresh', refresh_token: auth.refreshToken }),
      })
      if (r.ok) {
        const d = (await r.json()) as { access_token: string; expires_in: number }
        saveAuth({ ...auth, token: d.access_token, expiresAt: Date.now() + d.expires_in * 1000 })
        return true
      }
      if (r.status === 400 || r.status === 401) saveAuth(null) // refresh token 무효(철회 등)
    } catch { /* 네트워크 — 일시 실패로 처리 */ }
  }
  return false
}

let gisLoading: Promise<void> | null = null
function loadGis(): Promise<void> {
  if (window.google?.accounts) return Promise.resolve()
  if (gisLoading) return gisLoading
  gisLoading = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('GIS load failed'))
    document.head.appendChild(s)
  })
  return gisLoading
}

/** 인증 보유 여부 — 유효 토큰 또는 refresh token */
export function hasValidToken(): boolean {
  return !!auth && (auth.expiresAt > Date.now() + 60_000 || !!auth.refreshToken)
}

/** 사용자 제스처에서 호출 (1회 동의 팝업) → code 교환으로 refresh token 확보 */
export async function connect(): Promise<boolean> {
  if (!gcalEnabled) return false
  await loadGis()
  const code = await new Promise<string | null>(resolve => {
    const client = window.google!.accounts.oauth2.initCodeClient({
      client_id: GCAL_CLIENT_ID,
      // calendar(read/write): 조회 + Protask에서 옮긴 일정 쓰기(reschedule)
      scope: 'https://www.googleapis.com/auth/calendar',
      ux_mode: 'popup',
      callback: resp => resolve(resp.code ?? null),
    })
    client.requestCode()
  })
  if (!code) return false
  try {
    const r = await fetch(TOKEN_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'exchange', code }),
    })
    if (!r.ok) return false
    const d = (await r.json()) as { access_token: string; expires_in: number; refresh_token: string | null }
    saveAuth({
      token: d.access_token,
      expiresAt: Date.now() + d.expires_in * 1000,
      refreshToken: d.refresh_token ?? auth?.refreshToken ?? null, // 재동의 시 누락되면 기존 것 유지
    })
    return true
  } catch {
    return false
  }
}

export function disconnect() {
  saveAuth(null)
}

const API = 'https://www.googleapis.com/calendar/v3'

/** 공통 GET — 만료 시 자동 갱신 후 호출, 401/403을 사유로 변환 */
async function gget(url: string): Promise<{ res: Response } | GcalFail> {
  if (!(await ensureToken())) return { ok: false, reason: 'auth' }
  const res = await fetch(url, { headers: { Authorization: `Bearer ${auth!.token}` } })
  if (res.status === 401) {
    // 토큰만 무효화 — refresh token으로 다음 호출에서 재갱신 시도
    if (auth) saveAuth({ ...auth, expiresAt: 0 })
    return { ok: false, reason: 'auth' }
  }
  if (res.status === 403) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string; errors?: { reason?: string }[] } } | null
    const msg = body?.error?.message ?? ''
    if (/has not been used|is disabled|accessNotConfigured/i.test(msg) || body?.error?.errors?.some(x => x.reason === 'accessNotConfigured'))
      return { ok: false, reason: 'api_disabled', detail: msg }
    saveAuth(null)
    return { ok: false, reason: 'auth', detail: msg }
  }
  if (!res.ok) return { ok: false, reason: 'error', detail: `HTTP ${res.status}` }
  return { res }
}

/** 공통 PATCH — 쓰기(일정 수정). 401/403을 사유로 변환 */
async function gpatch(url: string, body: unknown): Promise<{ ok: true } | GcalFail> {
  if (!(await ensureToken())) return { ok: false, reason: 'auth' }
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${auth!.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (res.status === 401) {
    if (auth) saveAuth({ ...auth, expiresAt: 0 })
    return { ok: false, reason: 'auth' }
  }
  if (res.status === 403) {
    const b = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
    return { ok: false, reason: 'error', detail: b?.error?.message ?? '쓰기 권한 없음(읽기 전용 캘린더이거나 재연결 필요)' }
  }
  if (!res.ok) return { ok: false, reason: 'error', detail: `HTTP ${res.status}` }
  return { ok: true }
}

/** 'YYYY-MM-DD'에 n일 더한 로컬 날짜 문자열 (정오 기준으로 tz 경계 회피) */
function addDaysStr(d: string, n: number): string {
  const dt = new Date(`${d}T12:00:00`)
  dt.setDate(dt.getDate() + n)
  const m = String(dt.getMonth() + 1).padStart(2, '0')
  const day = String(dt.getDate()).padStart(2, '0')
  return `${dt.getFullYear()}-${m}-${day}`
}

/** ISO 일시를 정수 일수만큼 평행 이동 (UTC Z로 출력 — 한국은 DST 없어 정확) */
function shiftIso(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * 86400000).toISOString()
}

/** 일정을 newDate로 이동(기간·시각 유지). 종일=날짜, 시간일정=일수 평행이동 */
export async function rescheduleEvent(ev: GcalEvent, newDate: string): Promise<{ ok: true } | GcalFail> {
  if (ev.date === newDate) return { ok: true }
  let body: { start: { date: string } | { dateTime: string }; end: { date: string } | { dateTime: string } }
  if (ev.allDay) {
    const span = Math.max(1, Math.round((Date.parse(ev.end) - Date.parse(ev.start)) / 86400000))
    body = { start: { date: newDate }, end: { date: addDaysStr(newDate, span) } }
  } else {
    const delta = Math.round((Date.parse(`${newDate}T12:00:00`) - Date.parse(`${ev.date}T12:00:00`)) / 86400000)
    body = { start: { dateTime: shiftIso(ev.start, delta) }, end: { dateTime: shiftIso(ev.end, delta) } }
  }
  return gpatch(`${API}/calendars/${encodeURIComponent(ev.calendarId)}/events/${encodeURIComponent(ev.id)}`, body)
}

/** 표시 중인 캘린더 목록 */
export async function fetchCalendars(): Promise<{ ok: true; calendars: GcalCalendar[] } | GcalFail> {
  const r = await gget(`${API}/users/me/calendarList?minAccessRole=reader&maxResults=30`)
  if (!('res' in r)) return r
  const data = (await r.res.json()) as { items?: { id: string; summary?: string; selected?: boolean; primary?: boolean; backgroundColor?: string }[] }
  const calendars = (data.items ?? [])
    .filter(c => c.selected !== false)
    .map(c => ({ id: c.id, summary: c.summary ?? c.id, color: c.backgroundColor, primary: c.primary }))
  return { ok: true, calendars }
}

interface RawEvent { id: string; summary?: string; start: { dateTime?: string; date?: string }; end: { dateTime?: string; date?: string } }

/** 기간 내 일정 — 지정한 캘린더들에서 병렬 수집 */
export async function fetchEventsRange(
  timeMinISO: string,
  timeMaxISO: string,
  calendars: GcalCalendar[],
): Promise<{ ok: true; events: GcalEvent[] } | GcalFail> {
  if (!hasValidToken()) return { ok: false, reason: 'auth' }
  const params = new URLSearchParams({
    timeMin: timeMinISO,
    timeMax: timeMaxISO,
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '100',
  })
  const all: GcalEvent[] = []
  let fail: GcalFail | null = null
  await Promise.all(calendars.map(async c => {
    const r = await gget(`${API}/calendars/${encodeURIComponent(c.id)}/events?${params}`)
    if (!('res' in r)) {
      if (r.reason !== 'error') fail = r
      return
    }
    const d = (await r.res.json()) as { items?: RawEvent[] }
    for (const ev of d.items ?? []) {
      const start = ev.start.dateTime ?? ev.start.date ?? ''
      all.push({
        id: ev.id,
        summary: ev.summary ?? '(제목 없음)',
        start,
        end: ev.end.dateTime ?? ev.end.date ?? '',
        date: start.slice(0, 10),
        allDay: !ev.start.dateTime,
        color: c.color,
        calendarId: c.id,
        calendar: c.summary,
      })
    }
  }))
  if (fail && all.length === 0) return fail
  const seen = new Set<string>()
  const events = all
    .filter(e => (seen.has(e.id) ? false : (seen.add(e.id), true)))
    .sort((a, b) => a.date.localeCompare(b.date) || Number(a.allDay ? 0 : 1) - Number(b.allDay ? 0 : 1) || a.start.localeCompare(b.start))
  return { ok: true, events }
}
