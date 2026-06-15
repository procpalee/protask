import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { Inbox, Sun, CalendarDays, CalendarRange, Plus, Settings, Moon, SunMedium, LayoutGrid, CloudMoon, HelpCircle, ChevronRight, ChevronDown } from 'lucide-react'
import { useEffect, useState } from 'react'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useStore, selInbox, selToday, selOverdue, selScheduled, selSomeday } from '../store/store'
import { wsColor, type Workspace, type Project } from '../types'
import { onSyncStatus, type SyncStatus } from '../lib/sync'

const LS_EXP = 'pd-ws-expanded'
function loadExpanded(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(LS_EXP) || '[]') as string[]) } catch { return new Set() }
}
function saveExpanded(id: string, open: boolean) {
  const s = loadExpanded()
  if (open) s.add(id); else s.delete(id)
  try { localStorage.setItem(LS_EXP, JSON.stringify([...s])) } catch { /* ignore */ }
}

/** 워크스페이스 행 — 토글로 프로젝트 펼치기 */
function WorkspaceItem({ ws }: { ws: Workspace }) {
  const workspaces = useStore(s => s.workspaces)
  const projects = useStore(s => s.projects)
  const dragId = useStore(s => s.dragId)
  const [open, setOpen] = useState(() => loadExpanded().has(ws.id))
  const toggle = () => { const n = !open; setOpen(n); saveExpanded(ws.id, n) }
  const wsProjects = projects.filter(p => p.workspace_id === ws.id).sort((a, b) => a.position - b.position)
  const taskDragging = !!dragId && !dragId.startsWith('P:') && !dragId.startsWith('gcal:')
  return (
    <div>
      <div className="flex items-center">
        <button onClick={toggle} className="rounded p-0.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200" title={open ? '접기' : '프로젝트 펼치기'}>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <NavLink to={`/w/${ws.id}`} className={({ isActive }) => `flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1.5 text-[13px] font-medium transition-colors ${
          isActive ? 'bg-zinc-200/70 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50' : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-100'
        }`}>
          <span className="h-2 w-2 shrink-0 rounded-[3px]" style={{ background: wsColor(ws.id, workspaces) }} />
          <span className="truncate">{ws.name}</span>
        </NavLink>
      </div>
      {open && (
        <SortableContext items={wsProjects.map(p => `P:${p.id}`)} strategy={verticalListSortingStrategy}>
          <div className="mt-0.5 mb-1 ml-3 flex flex-col gap-0.5 border-l border-zinc-200 pl-2 dark:border-zinc-800">
            {wsProjects.map(p => <ProjectItem key={p.id} project={p} taskDragging={taskDragging} />)}
            {wsProjects.length === 0 && <div className="px-1.5 py-1 text-[11.5px] text-zinc-400">프로젝트 없음</div>}
          </div>
        </SortableContext>
      )}
    </div>
  )
}

/** 프로젝트 행 — 드래그로 순서 변경 + 태스크 드롭 시 배정 (id `P:<id>`) */
function ProjectItem({ project, taskDragging }: { project: Project; taskDragging: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } = useSortable({ id: `P:${project.id}` })
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const active = pathname === `/w/${project.workspace_id}/p/${project.id}`
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      onClick={() => navigate(`/w/${project.workspace_id}/p/${project.id}`)}
      title={project.title}
      className={`flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-[12.5px] transition-colors ${
        active ? 'bg-zinc-200/70 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50' : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800/60'
      } ${isDragging ? 'opacity-50' : ''} ${
        isOver && taskDragging ? '!bg-blue-200 dark:!bg-blue-900/50' : taskDragging ? 'bg-blue-50/50 dark:bg-blue-950/20' : ''
      }`}
    >
      <span className="truncate">{project.title}</span>
    </div>
  )
}

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
        {workspaces.map(w => <WorkspaceItem key={w.id} ws={w} />)}
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
