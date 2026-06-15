import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useShallow } from 'zustand/react/shallow'
import { ArrowLeft, CalendarDays, Columns3, Filter, Table2 } from 'lucide-react'
import { useStore, projectStats, visibleDone, kanbanColOf, kanbanPatch, useViewTabs } from '../store/store'
import { KANBAN_LABEL, KANBAN_ORDER, type KanbanCol } from '../types'
import { collectLabels, type GroupBy, type TaskGroup } from '../lib/group'
import ProjectTable from '../components/project/ProjectTable'
import ProjectBoard from '../components/project/ProjectBoard'
import ProjectCalendar from '../components/project/ProjectCalendar'

type View = 'table' | 'board' | 'calendar'
interface FilterState { showDone: boolean; labels: string[]; cols: KanbanCol[] }

const VIEW_TABS: { key: View; label: string; icon: typeof Table2 }[] = [
  { key: 'table', label: '테이블', icon: Table2 },
  { key: 'board', label: '보드', icon: Columns3 },
  { key: 'calendar', label: '캘린더', icon: CalendarDays },
]
const VIEW_KEYS: View[] = ['table', 'board', 'calendar']

export default function ProjectPage() {
  const { wsId, projectId } = useParams<{ wsId: string; projectId: string }>()
  const project = useStore(s => s.projects.find(p => p.id === projectId))
  const ws = useStore(s => s.workspaces.find(w => w.id === wsId))
  const allTasks = useStore(s => s.tasks)
  const addTask = useStore(s => s.addTask)
  const stats = useStore(useShallow(s => (projectId ? projectStats(s, projectId) : { done: 0, total: 0, pct: 0 })))

  const [view, setView] = useState<View>(() => {
    const v = localStorage.getItem('pd-projview') as View
    return VIEW_KEYS.includes(v) ? v : 'table'
  })
  const [groupBy, setGroupBy] = useState<GroupBy>(() => (localStorage.getItem('pd-projgroup') as GroupBy) || 'status')
  const [filter, setFilter] = useState<FilterState>({ showDone: true, labels: [], cols: [] })
  const [filterOpen, setFilterOpen] = useState(false)

  const setViewP = (v: View) => { setView(v); localStorage.setItem('pd-projview', v) }
  const setGroupP = (g: GroupBy) => { setGroupBy(g); localStorage.setItem('pd-projgroup', g) }
  useViewTabs(VIEW_TABS.map(t => t.key), view, k => setViewP(k as View))

  const projectTasks = useMemo(
    () => allTasks.filter(t => t.project_id === projectId && visibleDone(t)),
    [allTasks, projectId],
  )
  const labelOptions = useMemo(() => collectLabels(projectTasks), [projectTasks])

  const filtered = useMemo(
    () => projectTasks.filter(t => {
      if (!filter.showDone && t.status === 'done') return false
      if (filter.cols.length && !filter.cols.includes(kanbanColOf(t))) return false
      if (filter.labels.length && !filter.labels.some(l => t.labels.includes(l))) return false
      return true
    }),
    [projectTasks, filter],
  )

  if (!project || !ws) return <div className="p-8 text-zinc-400">프로젝트를 찾을 수 없습니다.</div>

  const onAddInGroup = (title: string, g: TaskGroup) => {
    const base = { title, project_id: project.id, workspace_id: ws.id }
    if (g.col) addTask({ ...base, ...kanbanPatch(g.col) })
    else if (g.label_value) addTask({ ...base, labels: [g.label_value] })
    else addTask(base)
  }

  const filterCount = (filter.showDone ? 0 : 1) + filter.cols.length + filter.labels.length
  const showGroup = view === 'table'

  return (
    <div className="flex h-full flex-col">
      {/* 헤더 */}
      <div className="flex flex-wrap items-center gap-2.5 px-5 pt-4 pb-2">
        <Link to={`/w/${ws.id}`} className="btn btn-ghost !px-1.5" title="워크스페이스로"><ArrowLeft size={15} /></Link>
        <h1 className="text-[17px] font-bold tracking-tight">{project.title}</h1>
        <span className="text-[13px] font-medium text-zinc-400">{ws.name}</span>
        <span className="text-[13px] font-medium text-zinc-400">· {stats.done}/{stats.total} ({stats.pct}%)</span>
        {project.descr && <span className="w-full pl-9 text-[13.5px] text-zinc-400 md:w-auto md:pl-0">{project.descr}</span>}
      </div>

      {/* 툴바: 뷰 탭 + 그룹화 + 필터 */}
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-5 pb-2 dark:border-zinc-800">
        <div className="flex items-center rounded-md border border-zinc-200 p-0.5 dark:border-zinc-700">
          {VIEW_TABS.map(t => {
            const Icon = t.icon
            return (
              <button
                key={t.key}
                onClick={() => setViewP(t.key)}
                className={`flex items-center gap-1.5 rounded px-2 py-1 text-[13px] font-semibold ${
                  view === t.key ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-zinc-50' : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
                }`}
              >
                <Icon size={13} /> {t.label}
              </button>
            )
          })}
        </div>

        {showGroup && (
          <label className="flex items-center gap-1.5 text-[13px] text-zinc-500 dark:text-zinc-400">
            그룹화
            <select className="input !h-7 !w-auto !py-0 !text-[13px]" value={groupBy} onChange={e => setGroupP(e.target.value as GroupBy)}>
              <option value="status">상태</option>
              <option value="label">라벨</option>
              <option value="none">없음</option>
            </select>
          </label>
        )}

        <div className="relative ml-auto">
          <button className={`btn !py-1 ${filterCount ? '!border-blue-400 !text-blue-600 dark:!text-blue-400' : ''}`} onClick={() => setFilterOpen(o => !o)}>
            <Filter size={13} /> 필터{filterCount ? ` (${filterCount})` : ''}
          </button>
          {filterOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setFilterOpen(false)} />
              <div className="absolute right-0 top-9 z-50 w-[230px] rounded-lg border border-zinc-200 bg-white p-3 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
                <label className="flex cursor-pointer items-center gap-2 text-[13.5px]">
                  <input type="checkbox" className="h-3.5 w-3.5 accent-blue-600" checked={filter.showDone} onChange={e => setFilter(f => ({ ...f, showDone: e.target.checked }))} />
                  완료 항목 표시
                </label>
                <div className="mt-2.5 border-t border-zinc-100 pt-2 dark:border-zinc-800">
                  <p className="mb-1 text-[12px] font-bold text-zinc-400">상태</p>
                  <div className="flex flex-wrap gap-1">
                    {KANBAN_ORDER.map(c => {
                      const on = filter.cols.includes(c)
                      return (
                        <button key={c} onClick={() => setFilter(f => ({ ...f, cols: on ? f.cols.filter(x => x !== c) : [...f.cols, c] }))}
                          className={`rounded-full border px-2 py-px text-[12px] font-medium ${on ? 'border-blue-400 bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400' : 'border-zinc-200 text-zinc-500 dark:border-zinc-700'}`}>
                          {KANBAN_LABEL[c]}
                        </button>
                      )
                    })}
                  </div>
                </div>
                {labelOptions.length > 0 && (
                  <div className="mt-2.5 border-t border-zinc-100 pt-2 dark:border-zinc-800">
                    <p className="mb-1 text-[12px] font-bold text-zinc-400">라벨</p>
                    <div className="flex flex-wrap gap-1">
                      {labelOptions.map(l => {
                        const on = filter.labels.includes(l)
                        return (
                          <button key={l} onClick={() => setFilter(f => ({ ...f, labels: on ? f.labels.filter(x => x !== l) : [...f.labels, l] }))}
                            className={`rounded-full border px-2 py-px text-[12px] font-medium ${on ? 'border-blue-400 bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400' : 'border-zinc-200 text-zinc-500 dark:border-zinc-700'}`}>
                            {l}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
                {filterCount > 0 && (
                  <button className="mt-3 w-full rounded-md border border-zinc-200 py-1 text-[13px] font-medium text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800" onClick={() => setFilter({ showDone: true, labels: [], cols: [] })}>
                    필터 초기화
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* 뷰 본문 */}
      <div className="min-h-0 flex-1 overflow-y-auto pt-3">
        {view === 'table' && <ProjectTable tasks={filtered} groupBy={groupBy} onAdd={onAddInGroup} />}
        {view === 'board' && <ProjectBoard tasks={filtered} projectId={project.id} wsId={ws.id} />}
        {view === 'calendar' && <ProjectCalendar tasks={filtered} />}
      </div>
    </div>
  )
}
