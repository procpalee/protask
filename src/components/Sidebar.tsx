import { NavLink, useNavigate } from 'react-router-dom'
import { Inbox, Sun, CalendarDays, CalendarRange, Plus, Settings, Moon, SunMedium, LayoutGrid, CloudMoon, HelpCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useStore, selInbox, selToday, selOverdue, selScheduled, selSomeday } from '../store/store'
import { wsColor } from '../types'
import { onSyncStatus, type SyncStatus } from '../lib/sync'

function CountBadge({ n }: { n: number }) {
  if (!n) return null
  return (
    <span className="ml-auto rounded-full bg-zinc-200 px-1.5 py-px text-[11px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
      {n}
    </span>
  )
}

function navCls({ isActive }: { isActive: boolean }) {
  return `flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors ${
    isActive
      ? 'bg-zinc-200/70 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50'
      : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-100'
  }`
}

export function useTheme() {
  const [dark, setDark] = useState(() => localStorage.getItem('pd-theme') === 'dark')
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem('pd-theme', dark ? 'dark' : 'light')
  }, [dark])
  return { dark, toggle: () => setDark(d => !d) }
}

export default function Sidebar({ dark, onToggleTheme }: { dark: boolean; onToggleTheme: () => void }) {
  const workspaces = useStore(s => s.workspaces)
  const inboxCount = useStore(s => selInbox(s).length)
  const todayCount = useStore(s => selOverdue(s).length + selToday(s).filter(t => t.status !== 'done').length)
  const scheduledCount = useStore(s => selScheduled(s).length)
  const somedayCount = useStore(s => selSomeday(s).length)
  const addWorkspace = useStore(s => s.addWorkspace)
  const navigate = useNavigate()
  const [sync, setSync] = useState<SyncStatus>('idle')
  const [pending, setPending] = useState(0)

  useEffect(() => onSyncStatus((s, p) => { setSync(s); setPending(p) }), [])

  const onAddWs = () => {
    const name = window.prompt('새 워크스페이스 이름')
    if (!name?.trim()) return
    const id = addWorkspace(name.trim())
    navigate(`/w/${id}`)
  }

  const dot =
    sync === 'idle' ? 'bg-emerald-500' : sync === 'saving' ? 'bg-amber-400' : sync === 'offline' ? 'bg-zinc-400' : 'bg-red-500'
  const dotTitle =
    sync === 'idle' ? '동기화됨' : sync === 'saving' ? `저장 중 (${pending})` : sync === 'offline' ? `오프라인 — 대기 ${pending}건` : `저장 실패 — 재시도 대기 ${pending}건`

  return (
    <aside className="hidden h-full w-[228px] shrink-0 flex-col border-r border-zinc-200 bg-zinc-100/60 md:flex dark:border-zinc-800 dark:bg-zinc-900/60">
      <div className="flex items-center gap-2 px-4 pt-4 pb-3">
        <img src="/icons/icon-192.png" alt="" className="h-5 w-5 rounded" />
        <span className="text-[13px] font-semibold tracking-tight">Protask</span>
        <span className={`ml-auto h-2 w-2 rounded-full ${dot}`} title={dotTitle} />
      </div>

      <nav className="flex flex-col gap-0.5 px-2.5">
        <NavLink to="/inbox" className={navCls}>
          <Inbox size={15.5} strokeWidth={1.9} />
          Inbox
          <CountBadge n={inboxCount} />
        </NavLink>
        <NavLink to="/" end className={navCls}>
          <Sun size={15.5} strokeWidth={1.9} />
          Today
          <CountBadge n={todayCount} />
        </NavLink>
        <NavLink to="/scheduled" className={navCls}>
          <CalendarDays size={15.5} strokeWidth={1.9} />
          Scheduled
          <CountBadge n={scheduledCount} />
        </NavLink>
        <NavLink to="/someday" className={navCls}>
          <CloudMoon size={15.5} strokeWidth={1.9} />
          Someday
          <CountBadge n={somedayCount} />
        </NavLink>
        <NavLink to="/calendar" className={navCls}>
          <CalendarRange size={15.5} strokeWidth={1.9} />
          Calendar
        </NavLink>
      </nav>

      <div className="mt-5 mb-1 flex items-center justify-between px-4">
        <span className="text-[11px] font-semibold tracking-wide text-zinc-400 uppercase dark:text-zinc-500">워크스페이스</span>
        <button onClick={onAddWs} className="rounded p-0.5 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200" title="새 워크스페이스">
          <Plus size={14} />
        </button>
      </div>
      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2.5 pb-2">
        {workspaces.map(w => (
          <NavLink key={w.id} to={`/w/${w.id}`} className={navCls}>
            <span className="h-2 w-2 shrink-0 rounded-[3px]" style={{ background: wsColor(w.id, workspaces) }} />
            <span className="truncate">{w.name}</span>
          </NavLink>
        ))}
        {workspaces.length === 0 && (
          <div className="px-2.5 py-2 text-[12px] text-zinc-400">
            <LayoutGrid size={14} className="mb-1" />
            워크스페이스가 없습니다
          </div>
        )}
      </nav>

      <div className="flex items-center gap-1 border-t border-zinc-200 px-2.5 py-2 dark:border-zinc-800">
        <NavLink to="/guide" className={navCls} title="사용 설명서">
          <HelpCircle size={15.5} strokeWidth={1.9} />
          설명서
        </NavLink>
        <NavLink to="/settings" className={navCls} title="설정">
          <Settings size={15.5} strokeWidth={1.9} />
          설정
        </NavLink>
        <button
          onClick={onToggleTheme}
          className="ml-auto rounded-md p-1.5 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          title="테마 전환"
        >
          {dark ? <SunMedium size={15.5} /> : <Moon size={15.5} />}
        </button>
      </div>
    </aside>
  )
}
