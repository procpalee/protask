import { Link, useNavigate } from 'react-router-dom'
import { ChevronRight, Plus } from 'lucide-react'
import { useStore, projectStats } from '../store/store'
import { promptDialog } from '../store/dialogStore'
import { wsColor } from '../types'

/** 모바일 하단 탭용 워크스페이스 목록 */
export default function WorkspaceListPage() {
  const workspaces = useStore(s => s.workspaces)
  const projects = useStore(s => s.projects)
  const store = useStore()
  const addWorkspace = useStore(s => s.addWorkspace)
  const navigate = useNavigate()

  return (
    <div className="mx-auto max-w-[680px] px-5 py-5">
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-[19px] font-bold tracking-tight">프로젝트</h1>
        <button
          className="btn ml-auto"
          onClick={async () => {
            const name = await promptDialog({ title: '새 프로젝트', placeholder: '프로젝트 이름', confirmLabel: '만들기' })
            if (name?.trim()) navigate(`/w/${addWorkspace(name.trim())}`)
          }}
        >
          <Plus size={14} /> 추가
        </button>
      </div>
      <div className="space-y-2">
        {workspaces.filter(w => !w.archived).map(w => {
          const wsProjects = projects.filter(p => p.workspace_id === w.id)
          const st = wsProjects.reduce(
            (acc, p) => {
              const s = projectStats(store, p.id)
              return { done: acc.done + s.done, total: acc.total + s.total }
            },
            { done: 0, total: 0 },
          )
          const pct = st.total ? Math.round((st.done / st.total) * 100) : 0
          return (
            <Link
              key={w.id}
              to={`/w/${w.id}`}
              className="flex items-center gap-3 rounded-lg border border-zinc-200 bg-white p-3.5 hover:border-blue-400 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-blue-600"
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-[4px]" style={{ background: wsColor(w.id, workspaces) }} />
              <div className="min-w-0 flex-1">
                <div className="text-[14.5px] font-semibold">{w.name}</div>
                <div className="text-[12.5px] text-zinc-400">서브프로젝트 {wsProjects.length} · 태스크 {st.done}/{st.total} ({pct}%)</div>
              </div>
              <ChevronRight size={15} className="shrink-0 text-zinc-300" />
            </Link>
          )
        })}
      </div>
    </div>
  )
}
