import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  DndContext, DragOverlay, PointerSensor, TouchSensor, closestCorners,
  useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core'
import { SortableContext, useSortable, rectSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Plus, Pencil, Trash2, ChevronUp, ChevronDown } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useStore, projectStats, useNavOrder } from '../../store/store'
import Modal from '../Modal'
import { between } from '../../lib/position'
import type { Project } from '../../types'

/** 워크스페이스 보드 — Phase 그룹 → 프로젝트 카드. 키보드 선택 + 드래그 정렬/이동 */
export default function WorkspaceBoard({ wsId, projects }: { wsId: string; projects: Project[] }) {
  const navigate = useNavigate()
  const phases = useStore(useShallow(s => s.phases.filter(p => p.workspace_id === wsId).sort((a, b) => a.position - b.position)))
  const allProjects = useStore(s => s.projects)
  const store = useStore()
  const [projModal, setProjModal] = useState<{ project: Project | null; phaseId: string | null } | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  )

  const phaseGroups = useMemo(() => {
    const groups = phases.map(ph => ({ id: ph.id as string | null, name: ph.name, projects: projects.filter(p => p.phase_id === ph.id).sort((a, b) => a.position - b.position) }))
    const none = projects.filter(p => !p.phase_id).sort((a, b) => a.position - b.position)
    if (none.length) groups.push({ id: null, name: '미분류', projects: none })
    return groups
  }, [phases, projects])

  // 키보드 내비: 표시 순서대로 프로젝트 id flat (kind=project)
  useNavOrder(useMemo(() => phaseGroups.flatMap(g => g.projects.map(p => p.id)), [phaseGroups]), 'project')

  const movePhase = (idx: number, dir: -1 | 1) => {
    const target = phases[idx + dir]
    if (!target) return
    const cur = phases[idx]
    store.updatePhase(cur.id, { position: target.position })
    store.updatePhase(target.id, { position: cur.position })
  }

  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null)
    const { active, over } = e
    if (!over) return
    const id = String(active.id)
    const proj = allProjects.find(p => p.id === id)
    if (!proj) return
    const overId = String(over.id)

    let targetPhase: string | null
    let ids: string[]
    let insertAt: number
    const groupOf = (phId: string | null) => phaseGroups.find(g => g.id === phId)?.projects ?? []

    if (overId.startsWith('phase:')) {
      targetPhase = overId.slice(6) === '__none' ? null : overId.slice(6)
      ids = groupOf(targetPhase).map(p => p.id).filter(x => x !== id)
      insertAt = ids.length
    } else {
      const overProj = allProjects.find(p => p.id === overId)
      if (!overProj) return
      targetPhase = overProj.phase_id
      const col = groupOf(targetPhase)
      const origIdx = col.findIndex(p => p.id === id)
      const overIdx = col.findIndex(p => p.id === overId)
      ids = col.map(p => p.id).filter(x => x !== id)
      const overPos = ids.indexOf(overId)
      insertAt = origIdx !== -1 && origIdx < overIdx ? overPos + 1 : overPos
    }

    if (proj.phase_id === targetPhase) {
      const before = groupOf(targetPhase).map(p => p.id)
      const after = [...ids.slice(0, insertAt), id, ...ids.slice(insertAt)]
      if (before.join() === after.join()) return
    }

    const prevPos = ids[insertAt - 1] ? allProjects.find(p => p.id === ids[insertAt - 1])?.position : undefined
    const nextPos = ids[insertAt] ? allProjects.find(p => p.id === ids[insertAt])?.position : undefined
    const pos = between(prevPos, nextPos)
    const phasePatch: Partial<Project> = proj.phase_id !== targetPhase ? { phase_id: targetPhase } : {}

    if (Number.isNaN(pos)) {
      if (phasePatch.phase_id !== undefined) store.updateProject(id, phasePatch)
      store.reorderProjects([...ids.slice(0, insertAt), id, ...ids.slice(insertAt)])
    } else {
      store.updateProject(id, { ...phasePatch, position: pos })
    }
  }

  const activeProj = activeId ? allProjects.find(p => p.id === activeId) : null

  return (
    <div className="mx-auto max-w-[1080px] px-5 pb-8">
      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
        {phaseGroups.length === 0 && (
          <div className="rounded-lg border border-dashed border-zinc-300 p-10 text-center text-zinc-400 dark:border-zinc-700">Phase를 추가해 시작하세요.</div>
        )}

        {phaseGroups.map((ph, idx) => (
          <PhaseSection
            key={ph.id ?? '__none'}
            phaseId={ph.id}
            name={ph.name}
            projects={ph.projects}
            canEdit={ph.id !== null}
            onMoveUp={() => movePhase(idx, -1)}
            onMoveDown={() => movePhase(idx, 1)}
            onRename={() => { const n = window.prompt('Phase 이름', ph.name); if (n?.trim()) store.updatePhase(ph.id!, { name: n.trim() }) }}
            onRemove={() => {
              const n = projects.filter(p => p.phase_id === ph.id).length
              if (window.confirm(n ? `Phase "${ph.name}"를 삭제할까요? 프로젝트 ${n}개는 미분류로 이동합니다.` : `Phase "${ph.name}"를 삭제할까요?`)) store.deletePhase(ph.id!)
            }}
            onAddProject={() => setProjModal({ project: null, phaseId: ph.id })}
            onEditProject={p => setProjModal({ project: p, phaseId: p.phase_id })}
            onOpenProject={p => navigate(`/w/${wsId}/p/${p.id}`)}
          />
        ))}

        <button className="btn mt-1" onClick={() => { const n = window.prompt('새 Phase 이름'); if (n?.trim()) store.addPhase(wsId, n.trim()) }}>
          <Plus size={14} /> Phase
        </button>

        <DragOverlay>{activeProj ? <CardBody project={activeProj} overlay /> : null}</DragOverlay>
      </DndContext>

      {projModal && <ProjectModal wsId={wsId} project={projModal.project} defaultPhaseId={projModal.phaseId} onClose={() => setProjModal(null)} />}
    </div>
  )
}

function PhaseSection({
  phaseId, name, projects, canEdit, onMoveUp, onMoveDown, onRename, onRemove, onAddProject, onEditProject, onOpenProject,
}: {
  phaseId: string | null; name: string; projects: Project[]; canEdit: boolean
  onMoveUp: () => void; onMoveDown: () => void; onRename: () => void; onRemove: () => void
  onAddProject: () => void; onEditProject: (p: Project) => void; onOpenProject: (p: Project) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `phase:${phaseId ?? '__none'}` })
  return (
    <section className="mb-6">
      <div className="group mb-2 flex items-center gap-2">
        <h2 className="text-[14.5px] font-bold">{name}</h2>
        <span className="text-[12.5px] font-medium text-zinc-400">{projects.length}</span>
        {canEdit && (
          <span className="invisible flex items-center gap-0.5 group-hover:visible">
            <button className="rounded p-0.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200" onClick={onMoveUp} title="위로"><ChevronUp size={13} /></button>
            <button className="rounded p-0.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200" onClick={onMoveDown} title="아래로"><ChevronDown size={13} /></button>
            <button className="rounded p-0.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200" onClick={onRename} title="이름 변경"><Pencil size={12.5} /></button>
            <button className="rounded p-0.5 text-zinc-400 hover:text-red-600" onClick={onRemove} title="삭제"><Trash2 size={12.5} /></button>
          </span>
        )}
      </div>
      <SortableContext items={projects.map(p => p.id)} strategy={rectSortingStrategy}>
        <div ref={setNodeRef} className={`grid grid-cols-1 gap-2.5 rounded-lg sm:grid-cols-2 lg:grid-cols-3 ${isOver ? 'outline-2 outline-dashed outline-blue-400/60' : ''}`}>
          {projects.map(p => <SortableCard key={p.id} project={p} onOpen={() => onOpenProject(p)} onEdit={() => onEditProject(p)} />)}
          <button
            className="flex min-h-[72px] items-center justify-center gap-1 rounded-lg border border-dashed border-zinc-300 text-[13.5px] font-medium text-zinc-400 hover:border-blue-400 hover:text-blue-600 dark:border-zinc-700 dark:hover:border-blue-600 dark:hover:text-blue-400"
            onClick={onAddProject}
          >
            <Plus size={14} /> 프로젝트
          </button>
        </div>
      </SortableContext>
    </section>
  )
}

function SortableCard({ project, onOpen, onEdit }: { project: Project; onOpen: () => void; onEdit: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: project.id })
  const selected = useStore(s => s.hoverTaskId === project.id)
  return (
    <div
      ref={setNodeRef}
      data-navid={project.id}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      className={isDragging ? 'opacity-40' : ''}
      onClick={onOpen}
    >
      <CardBody project={project} selected={selected} onEdit={onEdit} />
    </div>
  )
}

function CardBody({ project, overlay, selected, onEdit }: { project: Project; overlay?: boolean; selected?: boolean; onEdit?: () => void }) {
  const st = useStore(useShallow(s => projectStats(s, project.id)))
  return (
    <div
      className={`group cursor-pointer rounded-lg border bg-white p-3.5 transition-all hover:-translate-y-px hover:border-blue-400 hover:shadow-sm dark:bg-zinc-900 dark:hover:border-blue-600 ${
        overlay ? 'rotate-1 shadow-lg' : ''
      } ${selected ? 'border-blue-400 ring-2 ring-blue-500/50 dark:border-blue-600' : 'border-zinc-200 dark:border-zinc-800'}`}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-[14px] leading-snug font-semibold">{project.title}</h3>
        {onEdit && (
          <button
            className="invisible shrink-0 rounded p-0.5 text-zinc-400 group-hover:visible hover:text-zinc-700 dark:hover:text-zinc-200"
            onClick={e => { e.stopPropagation(); onEdit() }}
            onPointerDown={e => e.stopPropagation()}
            title="프로젝트 설정"
          >
            <Pencil size={12.5} />
          </button>
        )}
      </div>
      {project.descr && <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-zinc-400">{project.descr}</p>}
      <div className="mt-3 flex items-center gap-2">
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${st.pct}%` }} />
        </div>
        <span className="text-[12.5px] font-medium text-zinc-400">{st.done}/{st.total}</span>
      </div>
    </div>
  )
}

function ProjectModal({ wsId, project, defaultPhaseId, onClose }: { wsId: string; project: Project | null; defaultPhaseId: string | null; onClose: () => void }) {
  const phases = useStore(useShallow(s => s.phases.filter(p => p.workspace_id === wsId).sort((a, b) => a.position - b.position)))
  const store = useStore()
  const [title, setTitle] = useState(project?.title ?? '')
  const [descr, setDescr] = useState(project?.descr ?? '')
  const [phaseId, setPhaseId] = useState<string>(project?.phase_id ?? defaultPhaseId ?? '')

  const save = () => {
    const t = title.trim()
    if (!t) return
    if (project) store.updateProject(project.id, { title: t, descr, phase_id: phaseId || null })
    else store.addProject({ workspace_id: wsId, phase_id: phaseId || null, title: t, descr })
    onClose()
  }

  return (
    <Modal title={project ? '프로젝트 설정' : '새 프로젝트'} onClose={onClose}>
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-[12.5px] font-semibold text-zinc-400">이름</span>
          <input autoFocus className="input" value={title} onChange={e => setTitle(e.target.value)} onKeyDown={e => e.key === 'Enter' && save()} />
        </label>
        <label className="block">
          <span className="mb-1 block text-[12.5px] font-semibold text-zinc-400">Phase</span>
          <select className="input" value={phaseId} onChange={e => setPhaseId(e.target.value)}>
            <option value="">미분류</option>
            {phases.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[12.5px] font-semibold text-zinc-400">설명</span>
          <textarea className="input min-h-[60px]" value={descr} onChange={e => setDescr(e.target.value)} />
        </label>
        <div className="flex items-center justify-between pt-1">
          {project ? (
            <button className="btn btn-danger" onClick={() => {
              const n = store.tasks.filter(t => t.project_id === project.id).length
              if (window.confirm(`프로젝트 "${project.title}"와 태스크 ${n}개를 삭제할까요?`)) { store.deleteProject(project.id); onClose() }
            }}>
              <Trash2 size={13} /> 삭제
            </button>
          ) : <span />}
          <div className="flex gap-2">
            <button className="btn" onClick={onClose}>취소</button>
            <button className="btn btn-primary" onClick={save}>저장</button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
