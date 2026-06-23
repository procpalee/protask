import type { CSSProperties } from 'react'
import { useStore } from '../store/store'
import { wsColor } from '../types'

/** 태스크 소속 표시 칩 — 상위 프로젝트(워크스페이스) 기준으로 표시(서브프로젝트는 툴팁에만). */
export default function ProjectChip({ projectId, workspaceId }: { projectId: string | null; workspaceId: string | null }) {
  const projects = useStore(s => s.projects)
  const workspaces = useStore(s => s.workspaces)
  // 프로젝트(워크스페이스) 결정 — workspaceId 우선, 없으면 서브프로젝트의 상위에서 유추
  const wsId = workspaceId ?? (projectId ? projects.find(p => p.id === projectId)?.workspace_id ?? null : null)
  if (!wsId) return null
  const ws = workspaces.find(w => w.id === wsId)
  if (!ws) return null
  const sub = projectId ? projects.find(p => p.id === projectId) : null

  return (
    <span
      className="inline-flex max-w-[120px] items-center rounded-full bg-[var(--pc)] px-1.5 py-px text-[11px] font-medium text-white dark:brightness-[0.85] dark:saturate-[0.92]"
      style={{ '--pc': wsColor(ws.id, workspaces) } as CSSProperties}
      title={sub ? `${ws.name} / ${sub.title}` : ws.name}
    >
      <span className="truncate">{ws.name}</span>
    </span>
  )
}
