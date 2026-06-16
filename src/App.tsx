import { Suspense, useEffect, useRef, useState } from 'react'
import { BrowserRouter, Navigate, NavLink, Route, Routes } from 'react-router-dom'
import { Inbox, Sun, CalendarDays, LayoutGrid, Settings as SettingsIcon } from 'lucide-react'
import Sidebar, { useTheme } from './components/Sidebar'
import QuickCapture from './components/QuickCapture'
import Shortcuts from './components/Shortcuts'
import TaskDetail from './components/TaskDetail'
import TodayPage from './pages/Today'
import InboxPage from './pages/Inbox'
import UpcomingPage from './pages/Upcoming'
import SomedayPage from './pages/Someday'
import CalendarPage from './pages/Calendar'
import WorkspacePage from './pages/Workspace'
import ProjectPage from './pages/Project'
import SettingsPage from './pages/Settings'
import GuidePage from './pages/Guide'
import WorkspaceListPage from './pages/WorkspaceList'
import Login from './components/Login'
import { useStore } from './store/store'
import { useAuth, REQUIRE_AUTH } from './store/authStore'

export default function App() {
  const { dark, toggle } = useTheme()
  const fetchAll = useStore(s => s.fetchAll)
  const loaded = useStore(s => s.loaded)
  const detailTaskId = useStore(s => s.detailTaskId)
  const openDetail = useStore(s => s.openDetail)
  const session = useAuth(s => s.session)
  const authReady = useAuth(s => s.ready)
  const hiddenAt = useRef<number | null>(null)
  const authed = !REQUIRE_AUTH || !!session

  useEffect(() => {
    if (!authed) return // 로그인 전에는 데이터를 불러오지 않음(RLS로 어차피 거부됨)
    void fetchAll()
  }, [fetchAll, authed])

  // 5분 이상 hidden 후 복귀 시 refetch (outbox 비어있을 때만 — store에서 가드)
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt.current = Date.now()
      } else if (hiddenAt.current && Date.now() - hiddenAt.current > 5 * 60_000) {
        hiddenAt.current = null
        void fetchAll()
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [fetchAll])

  if (REQUIRE_AUTH && !authReady) {
    return <div className="flex h-full items-center justify-center text-[14px] text-zinc-400">불러오는 중…</div>
  }
  if (REQUIRE_AUTH && !session) {
    return <Login />
  }

  return (
    <BrowserRouter>
      <div className="flex h-full">
        <Sidebar dark={dark} onToggleTheme={toggle} />
        <main className="min-w-0 flex-1 overflow-y-auto pb-14 md:pb-0">
          {!loaded ? (
            <div className="flex h-full items-center justify-center text-[14px] text-zinc-400">불러오는 중…</div>
          ) : (
            <Suspense fallback={<div className="flex h-full items-center justify-center text-[14px] text-zinc-400">불러오는 중…</div>}>
              <Routes>
                <Route path="/" element={<TodayPage />} />
                <Route path="/inbox" element={<InboxPage />} />
                <Route path="/upcoming" element={<UpcomingPage />} />
                <Route path="/scheduled" element={<Navigate to="/upcoming" replace />} />
                <Route path="/someday" element={<SomedayPage />} />
                <Route path="/calendar" element={<CalendarPage />} />
                <Route path="/workspaces" element={<WorkspaceListPage />} />
                <Route path="/w/:wsId" element={<WorkspacePage />} />
                <Route path="/w/:wsId/p/:projectId" element={<ProjectPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/guide" element={<GuidePage />} />
              </Routes>
            </Suspense>
          )}
        </main>
      </div>
      <MobileNav />
      <QuickCapture />
      <Shortcuts />
      <Flash />
      {/* 상세 — 중앙 팝업 */}
      {detailTaskId && <TaskDetail key={detailTaskId} taskId={detailTaskId} onClose={() => openDetail(null)} />}
    </BrowserRouter>
  )
}

/** 하단 일시 알림 (pd:flash 이벤트) */
function Flash() {
  const [msg, setMsg] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const onFlash = (e: Event) => {
      setMsg(String((e as CustomEvent).detail))
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setMsg(null), 2200)
    }
    window.addEventListener('pd:flash', onFlash)
    return () => window.removeEventListener('pd:flash', onFlash)
  }, [])
  if (!msg) return null
  return (
    <div className="fixed bottom-16 left-1/2 z-[70] -translate-x-1/2 rounded-full bg-zinc-900 px-4 py-1.5 text-[13.5px] font-medium text-white shadow-lg md:bottom-6 dark:bg-zinc-100 dark:text-zinc-900">
      {msg}
    </div>
  )
}

function MobileNav() {
  const cls = ({ isActive }: { isActive: boolean }) =>
    `flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${
      isActive ? 'text-blue-600 dark:text-blue-400' : 'text-zinc-400'
    }`
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-zinc-200 bg-white/95 backdrop-blur md:hidden dark:border-zinc-800 dark:bg-zinc-950/95">
      <NavLink to="/" end className={cls}><Sun size={18} />Today</NavLink>
      <NavLink to="/inbox" className={cls}><Inbox size={18} />Inbox</NavLink>
      <NavLink to="/calendar" className={cls}><CalendarDays size={18} />Calendar</NavLink>
      <NavLink to="/workspaces" className={cls}><LayoutGrid size={18} />워크스페이스</NavLink>
      <NavLink to="/settings" className={cls}><SettingsIcon size={18} />설정</NavLink>
    </nav>
  )
}
