import { useMemo, useState } from 'react'
import {
  DndContext, DragOverlay, PointerSensor, TouchSensor, closestCorners, pointerWithin,
  useDroppable, useSensor, useSensors, type CollisionDetection, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Square, SquareCheckBig, ChevronDown, ChevronRight, Plus, Pencil, Trash2 } from 'lucide-react'
import { useStore, bucketOf, bucketPatch, useNavOrder, nid } from '../../store/store'
import { promptDialog, confirmDialog } from '../../store/dialogStore'
import { useContextMenu, MenuItem, useTaskContextMenu } from '../TaskContextMenu'
import { BUCKET_DOT, BUCKET_LABEL, type Bucket, type Task } from '../../types'
import { fmtDateShort } from '../../lib/dates'
import { between } from '../../lib/position'
import { groupTasks, countCk, type GroupBy, type TaskGroup } from '../../lib/group'
import type { Phase, Project } from '../../types'
import { DeadlineBadge, Subtasks, InlineSubAdd, addCkAtDepth } from '../TaskRow'

/** 노션식 테이블 뷰 — 그룹화(상태/라벨/프로젝트/Phase/없음)·접기·인라인 완료/상태·라벨 + 키보드 선택 + 드래그 */
export default function ProjectTable({
  tasks, groupBy, onAdd, projects = [], phases = [],
}: {
  tasks: Task[]
  groupBy: GroupBy
  onAdd: (title: string, group: TaskGroup) => void
  projects?: Project[]
  phases?: Phase[]
}) {
  const gridCls = 'grid-cols-[24px_1fr_88px_84px_110px]'
  const openDetail = useStore(s => s.openDetail)
  const toggleDone = useStore(s => s.toggleDone)
  const updateTask = useStore(s => s.updateTask)
  const rebalance = useStore(s => s.rebalance)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [activeId, setActiveId] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  )

  // 포인터 위치 우선 충돌감지 — 중첩 스크롤에서 드롭 누락 방지
  const collision: CollisionDetection = useMemo(() => args => {
    const p = pointerWithin(args)
    return p.length ? p : closestCorners(args)
  }, [])

  // Phase·프로젝트 2단계 중첩: 상위=Phase, 하위=프로젝트
  const nested = groupBy === 'phase-project'
  const nestedGroups = useMemo(
    () => nested ? groupTasks(tasks, 'phase', projects, phases).map(pg => ({ phase: pg, children: groupTasks(pg.tasks, 'project', projects) })) : null,
    [nested, tasks, projects, phases],
  )
  // 드래그/키보드 내비가 쓰는 리프 그룹 (중첩이면 프로젝트 하위 그룹들을 평탄화)
  const groups = useMemo(() => {
    const base = nested ? (nestedGroups ?? []).flatMap(n => n.children) : groupTasks(tasks, groupBy, projects, phases)
    // 프로젝트 리스트: 추가할 곳이 항상 있도록 '미분류' 그룹을 보장(비어 있어도 '+ 태스크' 입력 노출)
    if (groupBy === 'project' && !base.some(g => g.key === '__none'))
      return [...base, { key: '__none', label: '미분류', project_id: null as string | null, tasks: [] }]
    return base
  }, [nested, nestedGroups, tasks, groupBy, projects, phases])

  useNavOrder(useMemo(() => groups.flatMap(g => g.tasks.map(t => t.id)), [groups]), 'task')

  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null)
    const { active, over } = e
    if (!over) return
    const id = String(active.id)
    const task = tasks.find(t => t.id === id)
    if (!task) return
    const overId = String(over.id)

    let group: TaskGroup | undefined
    let ids: string[]
    let insertAt: number
    if (overId.startsWith('grp:')) {
      group = groups.find(g => g.key === overId.slice(4))
      if (!group) return
      ids = group.tasks.map(t => t.id).filter(x => x !== id)
      insertAt = ids.length
    } else {
      group = groups.find(g => g.tasks.some(t => t.id === overId))
      if (!group) return
      const col = group.tasks
      const origIdx = col.findIndex(t => t.id === id)
      const overIdx = col.findIndex(t => t.id === overId)
      ids = col.map(t => t.id).filter(x => x !== id)
      const overPos = ids.indexOf(overId)
      insertAt = origIdx !== -1 && origIdx < overIdx ? overPos + 1 : overPos
    }

    // 그룹 이동 패치: 구분 그룹→bucketPatch, 프로젝트 그룹→project_id
    let patch: Partial<Task> = {}
    if (groupBy === 'status' && group.col && bucketOf(task) !== group.col) patch = bucketPatch(group.col)
    else if ((groupBy === 'project' || groupBy === 'phase-project') && group.project_id !== undefined && task.project_id !== group.project_id) patch = { project_id: group.project_id }

    const sameGroup = Object.keys(patch).length === 0
    if (sameGroup) {
      const before = group.tasks.map(t => t.id)
      const after = [...ids.slice(0, insertAt), id, ...ids.slice(insertAt)]
      if (before.join() === after.join()) return
    }

    const prevPos = ids[insertAt - 1] ? tasks.find(t => t.id === ids[insertAt - 1])?.position : undefined
    const nextPos = ids[insertAt] ? tasks.find(t => t.id === ids[insertAt])?.position : undefined
    const pos = between(prevPos, nextPos)

    if (Number.isNaN(pos)) {
      updateTask(id, patch)
      rebalance([...ids.slice(0, insertAt), id, ...ids.slice(insertAt)], 'position')
    } else {
      updateTask(id, { ...patch, position: pos })
    }
  }

  const activeTask = activeId ? tasks.find(t => t.id === activeId) : null

  return (
    <div className="mx-auto max-w-[1000px] px-5 pb-8">
      <div className={`sticky top-0 z-20 grid ${gridCls} items-center gap-2 border-b border-zinc-200 bg-white px-2 py-1.5 text-[12px] font-semibold text-zinc-400 dark:border-zinc-800 dark:bg-zinc-950`}>
        <span /><span>제목</span><span>구분</span><span>실행일</span><span>마감일</span>
      </div>

      <DndContext sensors={sensors} collisionDetection={collision} autoScroll={false} onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
        {nested
          ? (nestedGroups ?? []).map(n => (
              <section key={n.phase.key} className="mb-1.5">
                <button className="flex w-full items-center gap-1.5 px-1 pt-3 pb-1 text-left" onClick={() => setCollapsed(c => ({ ...c, [n.phase.key]: !c[n.phase.key] }))}>
                  {collapsed[n.phase.key] ? <ChevronRight size={14} className="text-zinc-400" /> : <ChevronDown size={14} className="text-zinc-400" />}
                  <span className="text-[14px] font-bold">{n.phase.label}</span>
                  <span className="text-[12px] font-semibold text-zinc-400">{n.phase.tasks.length}</span>
                </button>
                {!collapsed[n.phase.key] && (
                  <div className="ml-[7px] border-l border-zinc-100 pl-3 dark:border-zinc-800">
                    {n.children.map(child => (
                      <GroupBlock
                        key={child.key}
                        group={child}
                        groupBy="project"
                        gridCls={gridCls}
                        collapsed={!!collapsed[child.key]}
                        onToggle={() => setCollapsed(c => ({ ...c, [child.key]: !c[child.key] }))}
                        onOpen={openDetail}
                        onToggleDone={toggleDone}
                        onAdd={title => onAdd(title, child)}
                      />
                    ))}
                  </div>
                )}
              </section>
            ))
          : groups.map(g => (
              <GroupBlock
                key={g.key}
                group={g}
                groupBy={groupBy}
                gridCls={gridCls}
                collapsed={!!collapsed[g.key]}
                onToggle={() => setCollapsed(c => ({ ...c, [g.key]: !c[g.key] }))}
                onOpen={openDetail}
                onToggleDone={toggleDone}
                onAdd={title => onAdd(title, g)}
              />
            ))}
      </DndContext>

      {groups.every(g => g.tasks.length === 0) && (
        <div className="mt-6 rounded-lg border border-dashed border-zinc-300 p-10 text-center text-[14px] text-zinc-400 dark:border-zinc-700">
          태스크가 없습니다 — 아래 그룹의 “+ 태스크”로 추가하세요.
        </div>
      )}

      <DragOverlay>{activeTask ? <div className="rounded border border-blue-300 bg-white px-3 py-1.5 text-[13.5px] shadow-lg dark:border-blue-700 dark:bg-zinc-800">{activeTask.title}</div> : null}</DragOverlay>
    </div>
  )
}

function GroupBlock({ group, groupBy, gridCls, collapsed, onToggle, onOpen, onToggleDone, onAdd }: {
  group: TaskGroup
  groupBy: GroupBy
  gridCls: string
  collapsed: boolean
  onToggle: () => void
  onOpen: (id: string) => void
  onToggleDone: (id: string) => void
  onAdd: (title: string) => void
}) {
  const [text, setText] = useState('')
  const showHeader = groupBy !== 'none'
  const { setNodeRef } = useDroppable({ id: `grp:${group.key}` })
  const updateProject = useStore(s => s.updateProject)
  const deleteProject = useStore(s => s.deleteProject)
  const isSub = groupBy === 'project' && !!group.project_id // 서브프로젝트 그룹(미분류 제외)
  const { onContextMenu, menu } = useContextMenu(close => (
    <>
      <MenuItem icon={Pencil} label="이름 변경" onClose={close} onPick={async () => {
        const n = await promptDialog({ title: '서브프로젝트 이름 변경', defaultValue: group.label, confirmLabel: '변경' })
        if (n?.trim()) updateProject(group.project_id!, { title: n.trim() })
      }} />
      <div className="my-1 h-px bg-zinc-100 dark:bg-zinc-800" />
      <MenuItem icon={Trash2} label="삭제" danger onClose={close} onPick={async () => {
        if (await confirmDialog({ title: '서브프로젝트 삭제', message: `"${group.label}"와 포함된 태스크가 모두 삭제됩니다. 진행할까요?`, confirmLabel: '삭제', danger: true })) deleteProject(group.project_id!)
      }} />
    </>
  ))

  const submit = () => { const v = text.trim(); if (v) onAdd(v); setText('') }

  return (
    <>
    <section className="mb-1">
      {showHeader && (
        <button className="flex w-full items-center gap-1.5 px-1 pt-3 pb-1 text-left" onClick={onToggle} onContextMenu={isSub ? onContextMenu : undefined}>
          {collapsed ? <ChevronRight size={13} className="text-zinc-400" /> : <ChevronDown size={13} className="text-zinc-400" />}
          {group.col && <span className={`h-2 w-2 rounded-full ${BUCKET_DOT[group.col]}`} />}
          <span className="text-[13.5px] font-bold">{group.label}</span>
          <span className="text-[12px] font-semibold text-zinc-400">{group.tasks.length}</span>
        </button>
      )}

      {!collapsed && (
        <div ref={setNodeRef}>
          <SortableContext items={group.tasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
            {group.tasks.map(t => <Row key={t.id} task={t} gridCls={gridCls} onOpen={onOpen} onToggleDone={onToggleDone} />)}
          </SortableContext>
          <div className="grid grid-cols-[24px_1fr] items-center gap-2 px-2 py-1">
            <Plus size={13} className="text-zinc-300" />
            <input
              className="h-7 bg-transparent text-[13.5px] outline-none placeholder:text-zinc-400"
              placeholder="+ 태스크"
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submit() }}
              onBlur={submit}
            />
          </div>
        </div>
      )}
    </section>
    {menu}
    </>
  )
}

function Row({ task, gridCls, onOpen, onToggleDone }: {
  task: Task
  gridCls: string
  onOpen: (id: string) => void
  onToggleDone: (id: string) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id })
  const selected = useStore(s => s.hoverTaskId === task.id)
  const updateTask = useStore(s => s.updateTask)
  const addingSub = useStore(s => s.addSubFor === task.id)
  const setAddSubFor = useStore(s => s.setAddSubFor)
  const { onContextMenu, menu } = useTaskContextMenu(task, onOpen)
  const done = task.status === 'done'
  const col = bucketOf(task)
  const ckTotal = countCk(task.checklist)
  const ckDone = countCk(task.checklist, true)
  return (
    <>
    <div
      ref={setNodeRef}
      data-navid={task.id}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      onContextMenu={onContextMenu}
      className={`grid ${gridCls} items-center gap-2 rounded-md border-b border-zinc-100 px-2 py-1.5 hover:bg-zinc-50 dark:border-zinc-800/60 dark:hover:bg-zinc-800/40 ${
        isDragging ? 'opacity-40' : ''
      } ${selected ? 'bg-zinc-50 ring-2 ring-blue-500/50 ring-inset dark:bg-zinc-800/40' : ''}`}
    >
      <button
        className={`shrink-0 ${done ? 'text-emerald-500' : 'text-zinc-300 hover:text-emerald-500 dark:text-zinc-600'}`}
        title="완료 토글"
        onClick={e => { e.stopPropagation(); onToggleDone(task.id) }}
        onPointerDown={e => e.stopPropagation()}
      >
        {done ? <SquareCheckBig size={16} /> : <Square size={16} />}
      </button>

      <button className="flex min-w-0 items-center gap-2 text-left" onClick={() => onOpen(task.id)}>
        <span className={`truncate text-[14px] ${done ? 'text-zinc-400 line-through' : ''}`}>{task.title}</span>
        {ckTotal > 0 && <span className="shrink-0 text-[12px] font-medium text-zinc-400">{ckDone}/{ckTotal}</span>}
      </button>

      <span className="flex items-center gap-1.5" title={BUCKET_LABEL[col]}>
        <span className={`h-2 w-2 shrink-0 rounded-full ${BUCKET_DOT[col as Bucket]}`} />
        <span className="text-[12.5px] text-zinc-500 dark:text-zinc-400">{BUCKET_LABEL[col]}</span>
      </span>

      <span className="text-[12.5px] text-zinc-500 dark:text-zinc-400">{task.scheduled_date ? fmtDateShort(task.scheduled_date) : ''}</span>

      <span className="flex">{task.deadline && !done ? <DeadlineBadge deadline={task.deadline} /> : task.deadline ? <span className="text-[12px] text-zinc-400">{fmtDateShort(task.deadline)}</span> : null}</span>
    </div>
    {task.checklist.length > 0 && (
      <Subtasks items={task.checklist} projectId={task.project_id} workspaceId={task.workspace_id} hideProjectTag onChange={next => updateTask(task.id, { checklist: next })} />
    )}
    {addingSub && (
      <InlineSubAdd
        onAdd={(title, depth) => updateTask(task.id, { checklist: addCkAtDepth(task.checklist, depth, { id: nid('ck'), title, done: false, children: [] }) })}
        onClose={() => setAddSubFor(null)}
      />
    )}
    {menu}
    </>
  )
}
