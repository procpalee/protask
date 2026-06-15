import { useMemo, useState } from 'react'
import {
  DndContext, DragOverlay, PointerSensor, TouchSensor, closestCorners, pointerWithin,
  useDroppable, useSensor, useSensors, type CollisionDetection, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Plus } from 'lucide-react'
import { useStore, visibleDone, kanbanColOf, kanbanPatch, useNavOrder } from '../../store/store'
import { KANBAN_DOT, KANBAN_LABEL, KANBAN_ORDER, type KanbanCol, type Task } from '../../types'
import { between } from '../../lib/position'
import { countCk } from '../../lib/group'
import { DeadlineBadge } from '../TaskRow'

/** 프로젝트 칸반 보드 — tasks는 이미 프로젝트·필터 적용된 목록 */
export default function ProjectBoard({ tasks, projectId, wsId }: { tasks: Task[]; projectId: string; wsId: string }) {
  const updateTask = useStore(s => s.updateTask)
  const addTask = useStore(s => s.addTask)
  const rebalance = useStore(s => s.rebalance)
  const openDetail = useStore(s => s.openDetail)
  const [activeId, setActiveId] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  )

  // 포인터 위치 우선(빈 컬럼·정확 위치), 없으면 모서리 근접 — 중첩 스크롤에서 드롭 누락 방지
  const collision: CollisionDetection = useMemo(() => args => {
    const p = pointerWithin(args)
    return p.length ? p : closestCorners(args)
  }, [])

  const byCol = useMemo(() => {
    const map = {} as Record<KanbanCol, Task[]>
    for (const c of KANBAN_ORDER) map[c] = []
    for (const t of tasks) {
      if (!visibleDone(t)) continue
      map[kanbanColOf(t)].push(t)
    }
    for (const c of KANBAN_ORDER) map[c].sort((a, b) => a.position - b.position)
    return map
  }, [tasks])

  useNavOrder(useMemo(() => KANBAN_ORDER.flatMap(c => byCol[c].map(t => t.id)), [byCol]), 'task')

  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null)
    const { active, over } = e
    if (!over) return
    const taskId = String(active.id)
    const task = tasks.find(t => t.id === taskId)
    if (!task) return

    const overId = String(over.id)
    const fromCol = kanbanColOf(task)
    let targetCol: KanbanCol
    let ids: string[]
    let insertAt: number

    if (overId.startsWith('col:')) {
      targetCol = overId.slice(4) as KanbanCol
      ids = byCol[targetCol].map(t => t.id).filter(id => id !== taskId)
      insertAt = ids.length
    } else {
      const overTask = tasks.find(t => t.id === overId)
      if (!overTask) return
      targetCol = kanbanColOf(overTask)
      const col = byCol[targetCol]
      const origIdx = col.findIndex(t => t.id === taskId)
      const overIdx = col.findIndex(t => t.id === overId)
      ids = col.map(t => t.id).filter(id => id !== taskId)
      const overPos = ids.indexOf(overId)
      insertAt = origIdx !== -1 && origIdx < overIdx ? overPos + 1 : overPos
    }

    if (fromCol === targetCol) {
      const before = byCol[targetCol].map(t => t.id)
      const after = [...ids.slice(0, insertAt), taskId, ...ids.slice(insertAt)]
      if (before.join() === after.join()) return
    }

    const prevId = ids[insertAt - 1]
    const nextId = ids[insertAt]
    const prevPos = prevId ? tasks.find(t => t.id === prevId)?.position : undefined
    const nextPos = nextId ? tasks.find(t => t.id === nextId)?.position : undefined
    const pos = between(prevPos, nextPos)

    const colPatch: Partial<Task> = fromCol !== targetCol ? kanbanPatch(targetCol) : {}

    if (Number.isNaN(pos)) {
      updateTask(taskId, colPatch)
      rebalance([...ids.slice(0, insertAt), taskId, ...ids.slice(insertAt)], 'position')
    } else {
      updateTask(taskId, { ...colPatch, position: pos })
    }
  }

  const activeTask = activeId ? tasks.find(t => t.id === activeId) : null

  return (
    <DndContext sensors={sensors} collisionDetection={collision} autoScroll={false} onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
      <div className="flex h-full snap-x snap-mandatory gap-3 overflow-x-auto px-5 pb-5 md:snap-none">
        {KANBAN_ORDER.map(c => (
          <Column key={c} col={c} tasks={byCol[c]} onOpen={openDetail} onAdd={title => addTask({ title, project_id: projectId, workspace_id: wsId, ...kanbanPatch(c) })} />
        ))}
      </div>
      <DragOverlay>{activeTask ? <CardBody task={activeTask} overlay /> : null}</DragOverlay>
    </DndContext>
  )
}

function Column({ col, tasks, onOpen, onAdd }: { col: KanbanCol; tasks: Task[]; onOpen: (id: string) => void; onAdd: (title: string) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${col}` })
  const [adding, setAdding] = useState(false)
  const [text, setText] = useState('')

  const commit = (keep: boolean) => {
    const v = text.trim()
    if (v) onAdd(v)
    setText('')
    if (!keep) setAdding(false)
  }

  return (
    <div
      ref={setNodeRef}
      className={`flex w-[82vw] shrink-0 snap-start flex-col rounded-lg border bg-zinc-100/70 md:w-[270px] dark:bg-zinc-900/70 ${
        isOver ? 'border-blue-400 dark:border-blue-600' : 'border-zinc-200 dark:border-zinc-800'
      }`}
    >
      <div className="flex items-center gap-2 px-3 pt-2.5 pb-1.5">
        <span className={`h-2 w-2 rounded-full ${KANBAN_DOT[col]}`} />
        <span className="text-[13.5px] font-bold">{KANBAN_LABEL[col]}</span>
        <span className="text-[12.5px] font-semibold text-zinc-400">{tasks.length}</span>
        <button className="ml-auto rounded p-0.5 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-800" onClick={() => setAdding(true)} title="태스크 추가">
          <Plus size={14} />
        </button>
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
              onKeyDown={e => {
                if (e.key === 'Enter') commit(true)
                if (e.key === 'Escape') { setText(''); setAdding(false) }
              }}
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
  return (
    <div
      ref={setNodeRef}
      data-navid={task.id}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      className={isDragging ? 'opacity-40' : ''}
      onClick={() => onOpen(task.id)}
    >
      <CardBody task={task} selected={selected} />
    </div>
  )
}

function CardBody({ task, overlay, selected }: { task: Task; overlay?: boolean; selected?: boolean }) {
  const cycleStatus = useStore(s => s.cycleStatus)
  const done = task.status === 'done'
  const ckTotal = countCk(task.checklist)
  const ckDone = countCk(task.checklist, true)
  return (
    <div
      className={`cursor-pointer rounded-md border bg-white p-2.5 shadow-[0_1px_2px_rgb(0_0_0/0.04)] transition-colors hover:border-blue-400 dark:bg-zinc-800/90 dark:hover:border-blue-600 ${
        overlay ? 'rotate-1 shadow-lg' : ''
      } ${done ? 'opacity-60' : ''} ${selected ? 'border-blue-400 ring-2 ring-blue-500/50 dark:border-blue-600' : 'border-zinc-200 dark:border-zinc-700'}`}
    >
      <div className="flex items-start gap-2">
        <button
          className={`mt-[3px] h-3 w-3 shrink-0 rounded-full ${KANBAN_DOT[kanbanColOf(task)]} transition-transform hover:scale-125`}
          title={`${KANBAN_LABEL[kanbanColOf(task)]} — 클릭하여 다음 단계로`}
          onClick={e => { e.stopPropagation(); cycleStatus(task.id) }}
          onPointerDown={e => e.stopPropagation()}
        />
        <div className="min-w-0 flex-1">
          <div className={`text-[13.5px] leading-snug ${done ? 'line-through' : ''}`}>{task.title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 empty:hidden">
            {ckTotal > 0 && <span className="text-[12px] font-medium text-zinc-400">{ckDone}/{ckTotal}</span>}
            {task.deadline && !done && <DeadlineBadge deadline={task.deadline} />}
            {task.scheduled_date && (
              <span className="text-[12px] font-medium text-zinc-400">{task.scheduled_date.slice(5).replace('-', '/')}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
