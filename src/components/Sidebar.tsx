import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { Inbox, Sun, CalendarClock, CalendarRange, CalendarDays, Plus, Pencil, Trash2, Settings, Moon, SunMedium, LayoutGrid, CloudMoon, HelpCircle, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useStore, selInbox, selToday, selOverdue, selDated, selSomeday } from '../store/store'
import { wsColor, type Workspace } from '../types'
import { onSyncStatus, retryNow, type SyncStatus } from '../lib/sync'
import { promptDialog, confirmDialog } from '../store/dialogStore'
import { useContextMenu, MenuItem } from './TaskContextMenu'

/** 사이드바 프로젝트 행 (최상위) — 클릭=프로젝트 뷰, 우클릭=이름 변경·삭제. */
function ProjectNavRow({ ws, workspaces }: { ws: Workspace; workspaces: Workspace[] }) {
  const updateWorkspace = useStore(s => s.updateWorkspace)
  const deleteWorkspace = useStore(s => s.deleteWorkspace)
  const navigate = useNavigate()
  const location = useLocation()
  const { onContextMenu, menu } = useContextMenu(close => (
    <>
      <MenuItem icon={Pencil} label="이름 변경" onClose={close} onPick={async () => {
        const n = await promptDialog({ title: '프로젝트 이름 변경', defaultValue: ws.name, confirmLabel: '변경' })
        if (n?.trim()) updateWorkspace(ws.id, { name: n.trim() })
      }} />
      <div className="my-1 h-px bg-zinc-100 dark:bg-zinc-800" />
      <MenuItem icon={Trash2} label="삭제" danger onClose={close} onPick={async () => {
        if (await confirmDialog({ title: '프로젝트 삭제', message: `"${ws.name}"와 모든 서브프로젝트·태스크를 삭제할까요?`, confirmLabel: '삭제', danger: true })) {
          deleteWorkspace(ws.id)
          if (location.pathname === `/w/${ws.id}`) navigate('/')
        }
      }} />
    </>
  ))
  return (
    <>
      <NavLink
        to={`/w/${ws.id}`}
        title={ws.name}
        onContextMenu={onContextMenu}
        className={({ isActive }) => `flex items-center gap-2 rounded-md px-1.5 py-1.5 text-[14px] font-medium transition-colors ${
          isActive ? 'bg-zinc-200/70 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50' : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-100'
        }`}
      >
        <span className="h-2.5 w-2.5 shrink-0 rounded-[4px]" style={{ background: wsColor(ws.id, workspaces) }} />
        <span className="truncate">{ws.name}</span>
      </NavLink>
      {menu}
    </>
  )
}

function CountBadge({ n }: { n: number }) {
  if (!n) return null
  return (
    <span className="ml-auto rounded-full bg-zinc-200 px-1.5 py-px text-[12px] font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
      {n}
    </span>
  )
}

function navCls({ isActive }: { isActive: boolean }) {
  return `flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[14px] font-medium transition-colors ${
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

/** 동기화 상태 점 — 사이드바 헤더·모바일 상단바 공용 */
export function SyncDot({ className = '' }: { className?: string }) {
  const [sync, setSync] = useState<SyncStatus>('idle')
  const [pending, setPending] = useState(0)
  useEffect(() => onSyncStatus((s, p) => { setSync(s); setPending(p) }), [])
  const dot =
    sync === 'idle' ? 'bg-emerald-500' : sync === 'saving' ? 'bg-amber-400' : sync === 'offline' ? 'bg-zinc-400' : 'bg-red-500'
  const stuck = sync === 'error' || sync === 'offline'
  const dotTitle =
    sync === 'idle' ? '동기화됨'
    : sync === 'saving' ? `저장 중 (${pending})`
    : sync === 'offline' ? `오프라인 — 대기 ${pending}건 · 클릭하면 지금 재시도`
    : `저장 실패 — 대기 ${pending}건 · 클릭하면 지금 재시도(안 되면 재로그인)`
  if (stuck) {
    return (
      <button
        type="button"
        onClick={() => retryNow()}
        title={dotTitle}
        aria-label={dotTitle}
        className={`h-2 w-2 shrink-0 rounded-full ${dot} ${className}`}
      />
    )
  }
  return <span className={`h-2 w-2 rounded-full ${dot} ${className}`} title={dotTitle} />
}

/** 사이드바 본문 — 데스크탑 고정 사이드바와 모바일 드로어가 공유 */
function SidebarContent({ dark, onToggleTheme, onClose }: { dark: boolean; onToggleTheme: () => void; onClose?: () => void }) {
  const workspaces = useStore(s => s.workspaces)
  const inboxCount = useStore(s => selInbox(s).length)
  const todayCount = useStore(s => selOverdue(s).length + selToday(s).filter(t => t.status !== 'done').length)
  const upcomingCount = useStore(s => selDated(s).length)
  const somedayCount = useStore(s => selSomeday(s).length)
  const addWorkspace = useStore(s => s.addWorkspace)
  const navigate = useNavigate()

  const onAddWs = async () => {
    const name = await promptDialog({ title: '새 프로젝트', placeholder: '프로젝트 이름', confirmLabel: '만들기' })
    if (!name?.trim()) return
    const id = addWorkspace(name.trim())
    navigate(`/w/${id}`)
  }

  return (
    <>
      <div className="flex items-center gap-2 px-4 pt-4 pb-3">
        <img src="/icons/icon-192.png" alt="" className="h-5 w-5 rounded" />
        <span className="text-[14px] font-semibold tracking-tight">Protask</span>
        <SyncDot className="ml-auto" />
        {onClose && (
          <button onClick={onClose} aria-label="닫기" className="rounded p-1 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200">
            <X size={16} />
          </button>
        )}
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
        {/* 이번주(주간 보드) — 데스크탑 전용(모바일 드로어/하단탭엔 숨김) */}
        <div className="hidden md:contents">
          <NavLink to="/week" className={navCls}>
            <CalendarDays size={15.5} strokeWidth={1.9} />
            This Week
          </NavLink>
        </div>
        <NavLink to="/upcoming" className={navCls}>
          <CalendarClock size={15.5} strokeWidth={1.9} />
          Upcoming
          <CountBadge n={upcomingCount} />
        </NavLink>
        <NavLink to="/someday" className={navCls}>
          <CloudMoon size={15.5} strokeWidth={1.9} />
          Someday
          <CountBadge n={somedayCount} />
        </NavLink>
        {/* 캘린더 — 모바일(드로어)에선 숨김, 데스크탑 사이드바에만 노출 */}
        <div className="hidden md:contents">
          <NavLink to="/calendar" className={navCls}>
            <CalendarRange size={15.5} strokeWidth={1.9} />
            Calendar
          </NavLink>
        </div>
      </nav>

      <div className="mt-5 mb-1 flex items-center justify-between px-4">
        <span className="text-[12px] font-semibold tracking-wide text-zinc-400 uppercase dark:text-zinc-500">프로젝트</span>
        <button onClick={onAddWs} className="rounded p-0.5 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200" title="새 프로젝트">
          <Plus size={14} />
        </button>
      </div>
      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2.5 pb-2">
        {workspaces.map(w => <ProjectNavRow key={w.id} ws={w} workspaces={workspaces} />)}
        {workspaces.length === 0 && (
          <div className="px-2.5 py-2 text-[13px] text-zinc-400">
            <LayoutGrid size={14} className="mb-1" />
            프로젝트가 없습니다
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
    </>
  )
}

/** 데스크탑 고정 사이드바 */
export default function Sidebar({ dark, onToggleTheme }: { dark: boolean; onToggleTheme: () => void }) {
  return (
    <aside className="hidden h-full w-[228px] shrink-0 flex-col border-r border-zinc-200 bg-zinc-100/60 md:flex dark:border-zinc-800 dark:bg-zinc-900/60">
      <SidebarContent dark={dark} onToggleTheme={onToggleTheme} />
    </aside>
  )
}

/** 모바일 드로어 — 햄버거로 여는 사이드바. 라우트 변경·백드롭·Esc로 닫힘 */
export function MobileDrawer({ open, onClose, dark, onToggleTheme }: { open: boolean; onClose: () => void; dark: boolean; onToggleTheme: () => void }) {
  const loc = useLocation()
  const mounted = useRef(false)
  // 라우트가 바뀌면 닫기(첫 마운트 제외)
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return }
    onClose()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc.pathname])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 md:hidden">
      <div className="absolute inset-0 animate-[panel-in_140ms_ease-out] bg-black/30 backdrop-blur-[1px]" onClick={onClose} />
      <aside className="absolute inset-y-0 left-0 flex w-[84vw] max-w-[300px] animate-[panel-in_140ms_ease-out] flex-col border-r border-zinc-200 bg-zinc-100 pl-[env(safe-area-inset-left)] shadow-2xl dark:border-zinc-800 dark:bg-zinc-900">
        <SidebarContent dark={dark} onToggleTheme={onToggleTheme} onClose={onClose} />
      </aside>
    </div>
  )
}
