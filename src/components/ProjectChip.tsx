import type { CSSProperties } from 'react'
import { Folder } from 'lucide-react'
import { useStore, projectColor } from '../store/store'

/** GTD 뷰에서 태스크 소속 표시 칩 — 프로젝트는 프로젝트 색 배경, 워크스페이스만이면 폴더(중립) */
export default function ProjectChip({ projectId, workspaceId }: { projectId: string | null; workspaceId: string | null }) {
  const projects = useStore(s => s.projects)
  const workspaces = useStore(s => s.workspaces)
  if (!projectId && !workspaceId) return null
  const project = projectId ? projects.find(p => p.id === projectId) : null

  if (project) {
    const ws = workspaces.find(w => w.id === project.workspace_id)
    return (
      <span
        className="inline-flex max-w-[110px] items-center rounded-full bg-[var(--pc)] px-1.5 py-px text-[11px] font-medium text-white dark:brightness-[0.85] dark:saturate-[0.92]"
        style={{ '--pc': projectColor(project.id, projects) } as CSSProperties}
        title={ws ? `${ws.name} / ${project.title}` : project.title}
      >
        <span className="truncate">{project.title}</span>
      </span>
    )
  }

  // 프로젝트 없이 워크스페이스만 — 폴더(중립색)
  const ws = workspaces.find(w => w.id === workspaceId)
  if (!ws) return null
  return (
    <span
      className="inline-flex max-w-[110px] items-center gap-1 rounded-full border border-zinc-200 bg-zinc-50 px-1.5 py-px text-[11px] font-medium text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800/70 dark:text-zinc-400"
      title={ws.name}
    >
      <Folder size={10} className="shrink-0" />
      <span className="truncate">{ws.name}</span>
    </span>
  )
}
