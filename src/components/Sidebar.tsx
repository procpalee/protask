import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { Inbox, Sun, CalendarClock, CalendarRange, CalendarDays, Plus, Pencil, Trash2, Settings, Moon, SunMedium, LayoutGrid, HelpCircle, X, Folder, FolderPlus, FolderMinus, Archive, ArchiveRestore, ChevronDown, ChevronRight } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useStore, selInbox, selToday, selOverdue, selDated, selWeek } from '../store/store'
import { wsColor, type Workspace, type Folder as FolderT } from '../types'
import { onSyncStatus, retryNow, type SyncStatus } from '../lib/sync'
import { promptDialog, confirmDialog } from '../store/dialogStore'
import { useContextMenu, MenuItem } from './TaskContextMenu'
import {
  DndContext, DragOverlay, PointerSensor, TouchSensor, pointerWithin, closestCenter,
  useDraggable, useDroppable, useSensor, useSensors,
  type CollisionDetection, type DragEndEvent,
} from '@dnd-kit/core'

const Divider = () => <div className="my-1 h-px bg-zinc-100 dark:bg-zinc-800" />

/** 사이드바 프로젝트 행 (최상위) — 클릭=프로젝트 뷰, 우클릭=이름변경·아카이브·폴더 이동·삭제. */
function ProjectNavRow({ ws, workspaces, folders }: { ws: Workspace; workspaces: Workspace[]; folders: FolderT[] }) {
  const updateWorkspace = useStore(s => s.updateWorkspace)
  const deleteWorkspace = useStore(s => s.deleteWorkspace)
  const addFolder = useStore(s => s.addFolder)
  const navigate = useNavigate()
  const location = useLocation()
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({ id: ws.id })
  const { onContextMenu, menu } = useContextMenu(close => (
    <>
      <MenuItem icon={Pencil} label="이름 변경" onClose={close} onPick={async () => {
        const n = await promptDialog({ title: '프로젝트 이름 변경', defaultValue: ws.name, confirmLabel: '변경' })
        if (n?.trim()) updateWorkspace(ws.id, { name: n.trim() })
      }} />
      <MenuItem icon={ws.archived ? ArchiveRestore : Archive} label={ws.archived ? '아카이브 해제' : '아카이브'} onClose={close} onPick={() => updateWorkspace(ws.id, { archived: !ws.archived })} />
      <Divider />
      <div className="px-2.5 py-0.5 text-[11.5px] font-semibold text-zinc-400">폴더로 이동</div>
      {folders.map(f => (
        <MenuItem key={f.id} icon={Folder} label={f.name} onClose={close} onPick={() => updateWorkspace(ws.id, { folder_id: f.id })} />
      ))}
      {ws.folder_id && <MenuItem icon={FolderMinus} label="폴더에서 빼기" onClose={close} onPick={() => updateWorkspace(ws.id, { folder_id: null })} />}
      <MenuItem icon={FolderPlus} label="새 폴더에 담기…" onClose={close} onPick={async () => {
        const n = await promptDialog({ title: '새 폴더', placeholder: '폴더 이름', confirmLabel: '만들기' })
        if (n?.trim()) updateWorkspace(ws.id, { folder_id: addFolder(n.trim()) })
      }} />
      <Divider />
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
        ref={setNodeRef}
        {...attributes}
        {...listeners}
        to={`/w/${ws.id}`}
        title={ws.name}
        onContextMenu={onContextMenu}
        className={({ isActive }) => `flex items-center gap-2 rounded-md px-1.5 py-1.5 text-[14px] font-medium transition-colors ${
          isActive ? 'bg-zinc-200/70 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50' : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-100'
        } ${ws.archived ? 'opacity-60' : ''} ${isDragging ? 'opacity-40' : ''}`}
      >
        <span className="h-2.5 w-2.5 shrink-0 rounded-[4px]" style={{ background: wsColor(ws.id, workspaces) }} />
        <span className="truncate">{ws.name}</span>
      </NavLink>
      {menu}
    </>
  )
}

/** 프로젝트 폴더(그룹) — 접기/펼치기 + 우클릭 이름변경·삭제 */
function FolderGroup({ folder, members, workspaces, folders }: { folder: FolderT; members: Workspace[]; workspaces: Workspace[]; folders: FolderT[] }) {
  const updateFolder = useStore(s => s.updateFolder)
  const deleteFolder = useStore(s => s.deleteFolder)
  const { setNodeRef, isOver } = useDroppable({ id: `folder:${folder.id}` })
  const [open, setOpen] = useState(() => localStorage.getItem(`pd-folder-${folder.id}`) !== '0')
  const toggle = () => setOpen(o => { localStorage.setItem(`pd-folder-${folder.id}`, o ? '0' : '1'); return !o })
  const { onContextMenu, menu } = useContextMenu(close => (
    <>
      <MenuItem icon={Pencil} label="폴더 이름 변경" onClose={close} onPick={async () => {
        const n = await promptDialog({ title: '폴더 이름 변경', defaultValue: folder.name, confirmLabel: '변경' })
        if (n?.trim()) updateFolder(folder.id, { name: n.trim() })
      }} />
      <Divider />
      <MenuItem icon={Trash2} label="폴더 삭제 (프로젝트는 유지)" danger onClose={close} onPick={async () => {
        if (await confirmDialog({ title: '폴더 삭제', message: `"${folder.name}" 폴더를 삭제할까요? 안의 프로젝트는 '폴더 없음'으로 남습니다.`, confirmLabel: '삭제', danger: true })) deleteFolder(folder.id)
      }} />
    </>
  ))
  return (
    <div ref={setNodeRef} className={`rounded-md ${isOver ? 'bg-blue-50/60 ring-2 ring-blue-400/60 dark:bg-blue-950/30' : ''}`}>
      <button onClick={toggle} onContextMenu={onContextMenu} className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left text-[13.5px] font-semibold text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800/60">
        {open ? <ChevronDown size={13} className="shrink-0 text-zinc-400" /> : <ChevronRight size={13} className="shrink-0 text-zinc-400" />}
        <Folder size={13.5} className="shrink-0 text-zinc-400" />
        <span className="truncate">{folder.name}</span>
        <span className="ml-auto text-[12px] font-semibold text-zinc-400">{members.length || ''}</span>
      </button>
      {open && (
        <div className="ml-3 border-l border-zinc-200 pl-1.5 dark:border-zinc-800">
          {members.map(w => <ProjectNavRow key={w.id} ws={w} workspaces={workspaces} folders={folders} />)}
          {members.length === 0 && <div className="px-1.5 py-1 text-[12.5px] text-zinc-400">비어 있음</div>}
        </div>
      )}
      {menu}
    </div>
  )
}

/** 폴더 없음 영역 드롭존 — 여기로 끌면 폴더에서 빼낸다 */
function UngroupZone({ children, dragging }: { children: ReactNode; dragging: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'folder:__none' })
  return (
    <div ref={setNodeRef} className={`rounded-md ${isOver ? 'bg-blue-50/60 ring-2 ring-blue-400/60 dark:bg-blue-950/30' : ''}`}>
      {children}
      {dragging && <div className="mx-1 my-1 rounded-md border border-dashed border-zinc-300 px-2.5 py-1.5 text-center text-[12px] text-zinc-400 dark:border-zinc-700">여기로 끌면 폴더에서 빼기</div>}
    </div>
  )
}

/** 아카이브된 프로젝트 — 접기/펼치기 */
function ArchiveSection({ archived, workspaces, folders }: { archived: Workspace[]; workspaces: Workspace[]; folders: FolderT[] }) {
  const [open, setOpen] = useState(() => localStorage.getItem('pd-archive-open') === '1')
  const toggle = () => setOpen(o => { localStorage.setItem('pd-archive-open', o ? '0' : '1'); return !o })
  return (
    <div className="mt-3 border-t border-zinc-200 pt-2 dark:border-zinc-800">
      <button onClick={toggle} className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left text-[13px] font-semibold text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800/60">
        {open ? <ChevronDown size={13} className="shrink-0 text-zinc-400" /> : <ChevronRight size={13} className="shrink-0 text-zinc-400" />}
        <Archive size={13} className="shrink-0 text-zinc-400" />
        <span>아카이브</span>
        <span className="ml-auto text-[12px] font-semibold text-zinc-400">{archived.length}</span>
      </button>
      {open && archived.map(w => <ProjectNavRow key={w.id} ws={w} workspaces={workspaces} folders={folders} />)}
    </div>
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
  const folders = useStore(s => s.folders)
  const inboxCount = useStore(s => selInbox(s).length)
  const todayCount = useStore(s => selOverdue(s).length + selToday(s).filter(t => t.status !== 'done').length)
  const weekCount = useStore(s => selWeek(s).length)
  const upcomingCount = useStore(s => selDated(s).length)
  const addWorkspace = useStore(s => s.addWorkspace)
  const addFolder = useStore(s => s.addFolder)
  const navigate = useNavigate()

  // 활성(비아카이브) 프로젝트를 폴더별로 분류 + 아카이브
  const active = workspaces.filter(w => !w.archived)
  const archived = workspaces.filter(w => w.archived)
  const sortedFolders = [...folders].sort((a, b) => a.position - b.position)
  const folderIds = new Set(folders.map(f => f.id))
  const ungrouped = active.filter(w => !w.folder_id || !folderIds.has(w.folder_id))

  const onAddWs = async () => {
    const name = await promptDialog({ title: '새 프로젝트', placeholder: '프로젝트 이름', confirmLabel: '만들기' })
    if (!name?.trim()) return
    const id = addWorkspace(name.trim())
    navigate(`/w/${id}`)
  }
  const onAddFolder = async () => {
    const name = await promptDialog({ title: '새 폴더', placeholder: '폴더 이름', confirmLabel: '만들기' })
    if (name?.trim()) addFolder(name.trim())
  }

  // 드래그앤드롭: 프로젝트를 폴더(또는 폴더 없음)로 끌어 담기
  const updateWorkspace = useStore(s => s.updateWorkspace)
  const [dragId, setDragId] = useState<string | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  )
  const collision: CollisionDetection = args => { const p = pointerWithin(args); return p.length ? p : closestCenter(args) }
  const onDragEnd = (e: DragEndEvent) => {
    setDragId(null)
    const { active, over } = e
    if (!over) return
    const overId = String(over.id)
    if (overId.startsWith('folder:')) {
      const fid = overId.slice(7)
      updateWorkspace(String(active.id), { folder_id: fid === '__none' ? null : fid })
    }
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
            <CountBadge n={weekCount} />
          </NavLink>
        </div>
        <NavLink to="/upcoming" className={navCls}>
          <CalendarClock size={15.5} strokeWidth={1.9} />
          Upcoming
          <CountBadge n={upcomingCount} />
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
        <div className="flex items-center gap-0.5">
          <button onClick={onAddFolder} className="rounded p-0.5 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200" title="새 폴더">
            <FolderPlus size={14} />
          </button>
          <button onClick={onAddWs} className="rounded p-0.5 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200" title="새 프로젝트">
            <Plus size={14} />
          </button>
        </div>
      </div>
      <DndContext sensors={sensors} collisionDetection={collision} onDragStart={e => setDragId(String(e.active.id))} onDragEnd={onDragEnd} onDragCancel={() => setDragId(null)}>
        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2.5 pb-2">
          {sortedFolders.map(f => (
            <FolderGroup key={f.id} folder={f} members={active.filter(w => w.folder_id === f.id)} workspaces={workspaces} folders={sortedFolders} />
          ))}
          <UngroupZone dragging={!!dragId}>
            {ungrouped.map(w => <ProjectNavRow key={w.id} ws={w} workspaces={workspaces} folders={sortedFolders} />)}
          </UngroupZone>
          {active.length === 0 && folders.length === 0 && (
            <div className="px-2.5 py-2 text-[13px] text-zinc-400">
              <LayoutGrid size={14} className="mb-1" />
              프로젝트가 없습니다
            </div>
          )}
          {archived.length > 0 && <ArchiveSection archived={archived} workspaces={workspaces} folders={sortedFolders} />}
        </nav>
        <DragOverlay>
          {dragId ? (
            <div className="rounded-md border border-blue-300 bg-white px-2 py-1.5 text-[14px] font-medium shadow-lg dark:border-blue-700 dark:bg-zinc-800">
              {workspaces.find(w => w.id === dragId)?.name}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

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
