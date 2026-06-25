import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useShallow } from 'zustand/react/shallow'
import { Columns3, Filter, List, Plus, Trash2 } from 'lucide-react'
import { useStore, projectStats, useViewTabs } from '../store/store'
import { promptDialog, confirmDialog } from '../store/dialogStore'
import { wsColor, WS_PALETTE, PROJECT_STATUS_LABEL, PROJECT_STATUS_ORDER, PROJECT_STATUS_DOT, type ProjectStatus } from '../types'
import type { TaskGroup } from '../lib/group'
import SubprojectBoard from '../components/workspace/SubprojectBoard'
import ProjectTable from '../components/project/ProjectTable'

type View = 'list' | 'board'
const VIEW_TABS: { key: View; label: string; icon: typeof List }[] = [
  { key: 'list', label: '리스트', icon: List },
  { key: 'board', label: '보드', icon: Columns3 },
]

/** 프로젝트 뷰 — 서브프로젝트(하위 섹션)별로 태스크를 묶어 보여준다. (구 워크스페이스 페이지) */
export default function WorkspacePage() {
  const { wsId } = useParams<{ wsId: string }>()
  const navigate = useNavigate()
  const ws = useStore(s => s.workspaces.find(w => w.id === wsId))
  const workspaces = useStore(s => s.workspaces)
  const allProjects = useStore(s => s.projects)
  const allTasks = useStore(s => s.tasks)
  const updateWorkspace = useStore(s => s.updateWorkspace)
  const deleteWorkspace = useStore(s => s.deleteWorkspace)
  const addProject = useStore(s => s.addProject)
  const addTask = useStore(s => s.addTask)
  const stats = useStore(useShallow(s => {
    const list = s.projects.filter(p => p.workspace_id === wsId)
    return list.reduce((a, p) => { const st = projectStats(s, p.id); return { done: a.done + st.done, total: a.total + st.total } }, { done: 0, total: 0 })
  }))

  const [view, setView] = useState<View>(() => {
    const v = localStorage.getItem('pd-wsview') as View
    return VIEW_TABS.some(t => t.key === v) ? v : 'list'
  })
  const [filter, setFilter] = useState<ProjectStatus[]>([])
  const [filterOpen, setFilterOpen] = useState(false)
  const [colorOpen, setColorOpen] = useState(false)

  const setViewP = (v: View) => { setView(v); localStorage.setItem('pd-wsview', v) }
  useViewTabs(VIEW_TABS.map(t => t.key), view, k => setViewP(k as View))

  const wsProjects = useMemo(() => allProjects.filter(p => p.workspace_id === wsId), [allProjects, wsId])
  const filtered = useMemo(() => (filter.length ? wsProjects.filter(p => filter.includes(p.status)) : wsProjects), [wsProjects, filter])
  const filteredIds = useMemo(() => new Set(filtered.map(p => p.id)), [filtered])
  const wsTasks = useMemo(
    () => allTasks.filter(t => t.workspace_id === wsId && (!filter.length || (t.project_id ? filteredIds.has(t.project_id) : false))),
    [allTasks, wsId, filter, filteredIds],
  )

  if (!ws) return <div className="p-8 text-zinc-400">프로젝트를 찾을 수 없습니다.</div>
  const pct = stats.total ? Math.round((stats.done / stats.total) * 100) : 0
  const showFilter = true
  const showAddSub = true

  // 리스트(서브프로젝트 그룹) 태스크 추가: project 그룹→project_id, 미분류→없음
  const wsOnAdd = (title: string, g: TaskGroup) => {
    if (g.project_id) addTask({ title, workspace_id: ws.id, project_id: g.project_id })
    else addTask({ title, workspace_id: ws.id })
  }
  const onAddSub = async () => {
    const name = await promptDialog({ title: '새 서브프로젝트', placeholder: '서브프로젝트 이름', confirmLabel: '만들기' })
    if (name?.trim()) addProject({ workspace_id: ws.id, phase_id: null, title: name.trim() })
  }

  return (
    <div className="flex h-full flex-col">
      {/* 헤더 */}
      <div className="flex flex-wrap items-center gap-3 px-5 pt-4 pb-2">
        <div className="relative">
          <button className="h-4 w-4 shrink-0 rounded-[5px] ring-2 ring-transparent ring-offset-1 ring-offset-white hover:ring-zinc-300 dark:ring-offset-zinc-950 dark:hover:ring-zinc-600" style={{ background: wsColor(ws.id, workspaces) }} title="색상 변경" onClick={() => setColorOpen(o => !o)} />
          {colorOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setColorOpen(false)} />
              <div className="absolute left-0 top-6 z-50 w-[176px] rounded-lg border border-zinc-200 bg-white p-2.5 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
                <div className="grid grid-cols-6 gap-1.5">
                  {WS_PALETTE.map(c => (
                    <button key={c} className={`h-5 w-5 rounded-[5px] hover:scale-110 ${ws.color === c ? 'ring-2 ring-zinc-400' : ''}`} style={{ background: c }} onClick={() => { updateWorkspace(ws.id, { color: c }); setColorOpen(false) }} />
                  ))}
                </div>
                <label className="mt-2 flex items-center gap-2 border-t border-zinc-100 pt-2 text-[12.5px] text-zinc-500 dark:border-zinc-800">
                  직접 선택
                  <input type="color" className="h-6 w-7 cursor-pointer rounded border-0 bg-transparent p-0" value={ws.color ?? wsColor(ws.id, workspaces)} onChange={e => updateWorkspace(ws.id, { color: e.target.value })} />
                </label>
              </div>
            </>
          )}
        </div>
        <h1 className="cursor-text text-[19px] font-bold tracking-tight" title="클릭하여 이름 변경" onClick={async () => { const n = await promptDialog({ title: '프로젝트 이름 변경', defaultValue: ws.name, confirmLabel: '변경' }); if (n?.trim()) updateWorkspace(ws.id, { name: n.trim() }) }}>{ws.name}</h1>
        <span className="text-[13.5px] font-medium text-zinc-400">{stats.done}/{stats.total} · {pct}%</span>
        <div className="h-1.5 w-40 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"><div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${pct}%` }} /></div>
        <button className="btn btn-danger ml-auto" title="프로젝트 삭제" onClick={async () => { if (await confirmDialog({ title: '프로젝트 삭제', message: `"${ws.name}"와 모든 서브프로젝트·태스크를 삭제할까요?`, confirmLabel: '삭제', danger: true })) { deleteWorkspace(ws.id); navigate('/') } }}>
          <Trash2 size={14} />
        </button>
      </div>

      {/* 툴바 */}
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-5 pb-2 dark:border-zinc-800">
        <div className="flex items-center rounded-md border border-zinc-200 p-0.5 dark:border-zinc-700">
          {VIEW_TABS.map(t => {
            const Icon = t.icon
            return (
              <button key={t.key} onClick={() => setViewP(t.key)} className={`flex items-center gap-1.5 rounded px-2 py-1 text-[13px] font-semibold ${view === t.key ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-50' : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'}`}>
                <Icon size={13} /> {t.label}
              </button>
            )
          })}
        </div>

        {showAddSub && (
          <button className="btn !py-1" onClick={onAddSub} title="서브프로젝트 추가"><Plus size={13} /> 서브프로젝트</button>
        )}

        {showFilter && (
          <div className="relative ml-auto">
            <button className={`btn !py-1 ${filter.length ? '!border-blue-400 !text-blue-600 dark:!text-blue-400' : ''}`} onClick={() => setFilterOpen(o => !o)}>
              <Filter size={13} /> 필터{filter.length ? ` (${filter.length})` : ''}
            </button>
            {filterOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setFilterOpen(false)} />
                <div className="absolute right-0 top-9 z-50 w-[200px] rounded-lg border border-zinc-200 bg-white p-3 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
                  <p className="mb-1 text-[12px] font-bold text-zinc-400">서브프로젝트 상태</p>
                  <div className="flex flex-wrap gap-1">
                    {PROJECT_STATUS_ORDER.map(st => {
                      const on = filter.includes(st)
                      return (
                        <button key={st} onClick={() => setFilter(f => on ? f.filter(x => x !== st) : [...f, st])} className={`flex items-center gap-1 rounded-full border px-2 py-px text-[12px] font-medium ${on ? 'border-blue-400 bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400' : 'border-zinc-200 text-zinc-500 dark:border-zinc-700'}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${PROJECT_STATUS_DOT[st]}`} />{PROJECT_STATUS_LABEL[st]}
                        </button>
                      )
                    })}
                  </div>
                  {filter.length > 0 && <button className="mt-3 w-full rounded-md border border-zinc-200 py-1 text-[13px] font-medium text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800" onClick={() => setFilter([])}>필터 초기화</button>}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* 본문 */}
      <div className="min-h-0 flex-1 overflow-y-auto pt-3">
        {view === 'list' && <ProjectTable tasks={wsTasks} groupBy="project" projects={wsProjects} onAdd={wsOnAdd} />}
        {view === 'board' && <SubprojectBoard wsId={ws.id} projects={filtered} tasks={wsTasks} />}
      </div>
    </div>
  )
}
