import { useMemo, useState } from 'react'
import {
  DndContext, DragOverlay, PointerSensor, TouchSensor, closestCorners, pointerWithin,
  useDroppable, useSensor, useSensors, type CollisionDetection, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Square, SquareCheckBig, Plus, Pencil, Trash2 } from 'lucide-react'
import { useStore, useNavOrder, projectColor } from '../../store/store'
import { promptDialog, confirmDialog } from '../../store/dialogStore'
import { paletteColor, type Project, type Task } from '../../types'
import { between } from '../../lib/position'
import { useTaskContextMenu } from '../TaskContextMenu'
import { countCk } from '../../lib/group'
import { DeadlineBadge, Subtasks } from '../TaskRow'
import { fmtDateShort } from '../../lib/dates'

const NONE = '__none'

/** 서브프로젝트 칸반 — 컬럼=서브프로젝트(+미분류). 카드 드롭 시 project_id 배정. */
export default function SubprojectBoard({ wsId, projects, tasks }: { wsId: string; projects: Project[]; tasks: Task[] }) {
  const updateTask = useStore(s => s.updateTask)
  const addTask = useStore(s => s.addTask)
  const addProject = useStore(s => s.addProject)
  const rebalance = useStore(s => s.rebalance)
  const openDetail = useStore(s => s.openDetail)
  const allProjects = useStore(s => s.projects)
  const [activeId, setActiveId] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  )
  const collision: CollisionDetection = useMemo(() => args => {
    const p = pointerWithin(args)
    return p.length ? p : closestCorners(args)
  }, [])

  const ordered = useMemo(() => [...projects].sort((a, b) => a.position - b.position), [projects])
  const byCol = useMemo(() => {
    const map: Record<string, Task[]> = { [NONE]: [] }
    for (const p of ordered) map[p.id] = []
    for (const t of tasks) (map[t.project_id && map[t.project_id] ? t.project_id : NONE] ??= []).push(t)
    for (const k of Object.keys(map)) map[k].sort((a, b) => a.position - b.position)
    return map
  }, [ordered, tasks])

  const columns = useMemo(() => [...ordered.map(p => p.id), NONE], [ordered])
  useNavOrder(useMemo(() => columns.flatMap(c => (byCol[c] ?? []).map(t => t.id)), [columns, byCol]), 'task')

  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null)
    const { active, over } = e
    if (!over) return
    const taskId = String(active.id)
    const task = tasks.find(t => t.id === taskId)
    if (!task) return
    const overId = String(over.id)
    const fromCol = task.project_id && byCol[task.project_id] ? task.project_id : NONE

    let targetCol: string
    let ids: string[]
    let insertAt: number
    if (overId.startsWith('col:')) {
      targetCol = overId.slice(4)
      ids = (byCol[targetCol] ?? []).map(t => t.id).filter(id => id !== taskId)
      insertAt = ids.length
    } else {
      const overTask = tasks.find(t => t.id === overId)
      if (!overTask) return
      targetCol = overTask.project_id && byCol[overTask.project_id] ? overTask.project_id : NONE
      const col = byCol[targetCol] ?? []
      const origIdx = col.findIndex(t => t.id === taskId)
      const overIdx = col.findIndex(t => t.id === overId)
      ids = col.map(t => t.id).filter(id => id !== taskId)
      const overPos = ids.indexOf(overId)
      insertAt = origIdx !== -1 && origIdx < overIdx ? overPos + 1 : overPos
    }

    if (fromCol === targetCol) {
      const before = (byCol[targetCol] ?? []).map(t => t.id)
      const after = [...ids.slice(0, insertAt), taskId, ...ids.slice(insertAt)]
      if (before.join() === after.join()) return
    }

    const patch: Partial<Task> = fromCol !== targetCol
      ? { project_id: targetCol === NONE ? null : targetCol, workspace_id: wsId }
      : {}
    const prevPos = ids[insertAt - 1] ? tasks.find(t => t.id === ids[insertAt - 1])?.position : undefined
    const nextPos = ids[insertAt] ? tasks.find(t => t.id === ids[insertAt])?.position : undefined
    const pos = between(prevPos, nextPos)
    if (Number.isNaN(pos)) {
      updateTask(taskId, patch)
      rebalance([...ids.slice(0, insertAt), taskId, ...ids.slice(insertAt)], 'position')
    } else {
      updateTask(taskId, { ...patch, position: pos })
    }
  }

  const onAddSub = async () => {
    const name = await promptDialog({ title: '새 서브프로젝트', placeholder: '서브프로젝트 이름', confirmLabel: '만들기' })
    if (name?.trim()) addProject({ workspace_id: wsId, phase_id: null, title: name.trim() })
  }

  const activeTask = activeId ? tasks.find(t => t.id === activeId) : null

  return (
    <DndContext sensors={sensors} collisionDetection={collision} autoScroll={false} onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
      <div className="flex h-full snap-x snap-mandatory gap-3 overflow-x-auto px-5 pb-5 md:snap-none">
        {ordered.map((p, i) => (
          <Column key={p.id} colId={p.id} title={p.title} color={projectColor(p.id, allProjects) || paletteColor(i)} tasks={byCol[p.id] ?? []} onOpen={openDetail}
            project={p}
            onAdd={title => addTask({ title, workspace_id: wsId, project_id: p.id })} />
        ))}
        <Column colId={NONE} title="미분류" tasks={byCol[NONE] ?? []} onOpen={openDetail}
          onAdd={title => addTask({ title, workspace_id: wsId })} />
        <button onClick={onAddSub} className="flex h-9 shrink-0 items-center gap-1 self-start rounded-lg border border-dashed border-zinc-300 px-3 text-[13px] font-medium text-zinc-500 hover:border-blue-400 hover:text-blue-600 dark:border-zinc-700 dark:hover:border-blue-500 dark:hover:text-blue-400">
          <Plus size={14} /> 서브프로젝트
        </button>
      </div>
      <DragOverlay>{activeTask ? <CardBody task={activeTask} overlay /> : null}</DragOverlay>
    </DndContext>
  )
}

function Column({ colId, title, color, tasks, project, onOpen, onAdd }: {
  colId: string; title: string; color?: string; tasks: Task[]; project?: Project
  onOpen: (id: string) => void; onAdd: (title: string) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${colId}` })
  const updateProject = useStore(s => s.updateProject)
  const deleteProject = useStore(s => s.deleteProject)
  const [adding, setAdding] = useState(false)
  const [text, setText] = useState('')
  const commit = (keep: boolean) => { const v = text.trim(); if (v) onAdd(v); setText(''); if (!keep) setAdding(false) }

  return (
    <div
      ref={setNodeRef}
      className={`group/col flex w-[82vw] shrink-0 snap-start flex-col rounded-lg border bg-zinc-100/70 md:w-[260px] dark:bg-zinc-900/70 ${isOver ? 'border-blue-400 dark:border-blue-600' : 'border-zinc-200 dark:border-zinc-800'}`}
    >
      <div className="flex items-center gap-2 px-3 pt-2.5 pb-1.5">
        {color && <span className="h-2 w-2 shrink-0 rounded-[3px]" style={{ background: color }} />}
        <span className="truncate text-[13.5px] font-bold">{title}</span>
        <span className="shrink-0 text-[12.5px] font-semibold text-zinc-400">{tasks.length}</span>
        <span className="ml-auto flex shrink-0 items-center gap-0.5">
          {project && (
            <>
              <button className="invisible rounded p-0.5 text-zinc-400 group-hover/col:visible hover:text-zinc-700 dark:hover:text-zinc-200" title="이름 변경"
                onClick={async () => { const n = await promptDialog({ title: '서브프로젝트 이름 변경', defaultValue: project.title, confirmLabel: '변경' }); if (n?.trim()) updateProject(project.id, { title: n.trim() }) }}><Pencil size={12} /></button>
              <button className="invisible rounded p-0.5 text-zinc-400 group-hover/col:visible hover:text-red-600" title="서브프로젝트 삭제"
                onClick={async () => { if (await confirmDialog({ title: '서브프로젝트 삭제', message: `"${project.title}"와 그 태스크를 삭제할까요?`, confirmLabel: '삭제', danger: true })) deleteProject(project.id) }}><Trash2 size={12} /></button>
            </>
          )}
          <button className="rounded p-0.5 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-800" onClick={() => setAdding(true)} title="태스크 추가"><Plus size={14} /></button>
        </span>
      </div>
      <SortableContext items={tasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
        <div className="flex min-h-[60px] flex-1 flex-col gap-1.5 overflow-y-auto px-2 pb-2">
          {tasks.map(t => <SortableCard key={t.id} task={t} onOpen={onOpen} />)}
          {adding && (
            <input
              autoFocus
              className="input !text-[13.5px]"
              placeholder="태스크 입력 후 Enter"
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') commit(true); if (e.key === 'Escape') { setText(''); setAdding(false) } }}
              onBlur={() => commit(false)}
            />
          )}
        </div>
      </SortableContext>
    </div>
  )
}

function SortableCard({ task, onOpen }: { task: Task; onOpen: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id })
  const selected = useStore(s => s.hoverTaskId === task.id)
  const { onContextMenu, menu } = useTaskContextMenu(task, onOpen)
  return (
    <>
      <div ref={setNodeRef} data-navid={task.id} style={{ transform: CSS.Transform.toString(transform), transition }} {...attributes} {...listeners}
        className={isDragging ? 'opacity-40' : ''} onClick={() => onOpen(task.id)} onContextMenu={onContextMenu}>
        <CardBody task={task} selected={selected} />
      </div>
      {menu}
    </>
  )
}

function CardBody({ task, overlay, selected }: { task: Task; overlay?: boolean; selected?: boolean }) {
  const toggleDone = useStore(s => s.toggleDone)
  const updateTask = useStore(s => s.updateTask)
  const done = task.status === 'done'
  const ckTotal = countCk(task.checklist)
  const ckDone = countCk(task.checklist, true)
  return (
    <div className={`cursor-pointer rounded-md border bg-white p-2.5 shadow-[0_1px_2px_rgb(0_0_0/0.04)] transition-colors hover:border-blue-400 dark:bg-zinc-800/90 dark:hover:border-blue-600 ${overlay ? 'rotate-1 shadow-lg' : ''} ${done ? 'opacity-60' : ''} ${selected ? 'border-blue-400 ring-2 ring-blue-500/50 dark:border-blue-600' : 'border-zinc-200 dark:border-zinc-700'}`}>
      <div className="flex items-start gap-2">
        <button className={`mt-[1px] shrink-0 ${done ? 'text-emerald-500' : 'text-zinc-300 hover:text-emerald-500 dark:text-zinc-600'}`}
          title="완료 토글" onClick={e => { e.stopPropagation(); toggleDone(task.id) }} onPointerDown={e => e.stopPropagation()}>
          {done ? <SquareCheckBig size={16} /> : <Square size={16} />}
        </button>
        <div className="min-w-0 flex-1">
          <div className={`text-[13.5px] leading-snug ${done ? 'line-through' : ''}`}>{task.title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 empty:hidden">
            {ckTotal > 0 && <span className="text-[12px] font-medium text-zinc-400">{ckDone}/{ckTotal}</span>}
            {task.deadline && !done && <DeadlineBadge deadline={task.deadline} />}
            {task.scheduled_date && <span className="text-[12px] font-medium text-zinc-400">{fmtDateShort(task.scheduled_date)}</span>}
          </div>
        </div>
      </div>
      {task.checklist.length > 0 && (
        <Subtasks items={task.checklist} projectId={task.project_id} workspaceId={task.workspace_id} hideProjectTag onChange={next => updateTask(task.id, { checklist: next })} />
      )}
    </div>
  )
}
