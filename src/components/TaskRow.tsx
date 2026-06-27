import { useEffect, useRef, useState } from 'react'
import { Square, SquareCheckBig, CalendarDays, FolderInput, CircleSlash, Star, Pencil, ListPlus, Trash2, IndentIncrease, IndentDecrease, ChevronDown, ChevronRight } from 'lucide-react'
import { wsColor, type Task, type ChecklistItem } from '../types'
import { useStore, projectColor, nid } from '../store/store'
import ProjectChip from './ProjectChip'
import PlanPopover from './PlanPopover'
import { useTaskContextMenu, useContextMenu, MenuItem } from './TaskContextMenu'
import { promptDialog } from '../store/dialogStore'
import { daysFromToday, fmtDateShort } from '../lib/dates'

/** 서브태스크 접힘 상태(노드 id별, localStorage 유지) */
function useCollapsed(id: string) {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(`pd-ck-collapsed-${id}`) === '1')
  const toggle = () => setCollapsed(v => { localStorage.setItem(`pd-ck-collapsed-${id}`, v ? '0' : '1'); return !v })
  return [collapsed, toggle] as const
}

/** 서브태스크 접기/펼치기 토글 — 평소엔 숨기고 hover/선택 시 노출(접혀 있으면 항상 표시). 좌측 정렬 유지 위해 우측 배치. */
function CollapseToggle({ collapsed, selected, onToggle }: { collapsed: boolean; selected?: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={e => { e.stopPropagation(); onToggle() }}
      className={`shrink-0 rounded p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 group-hover:visible touch:visible dark:hover:bg-zinc-800 dark:hover:text-zinc-300 ${collapsed || selected ? 'visible' : 'invisible'}`}
      title={collapsed ? '서브태스크 펼치기' : '서브태스크 접기'}
    >
      {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
    </button>
  )
}

/** GTD 리스트 공용 행: 완료 토글 + 제목 + 칩 + deadline 배지 + hover/키보드 퀵 액션 */
export default function TaskRow({
  task,
  onOpen,
  trailing,
}: {
  task: Task
  onOpen: (id: string) => void
  trailing?: React.ReactNode
}) {
  const toggleDone = useStore(s => s.toggleDone)
  const updateTask = useStore(s => s.updateTask)
  const selected = useStore(s => s.hoverTaskId === task.id)
  const addingSub = useStore(s => s.addSubFor === task.id)
  const setAddSubFor = useStore(s => s.setAddSubFor)
  const done = task.status === 'done'
  const ref = useRef<HTMLDivElement>(null)
  const { onContextMenu, menu: ctxMenu } = useTaskContextMenu(task, onOpen)

  // 키보드로 선택되면 화면 안으로 스크롤
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const ckTotal = countCk(task.checklist)
  const [collapsed, toggleCollapsed] = useCollapsed(task.id)

  return (
    <div>
      <div
        ref={ref}
        className={`group flex min-h-[44px] cursor-pointer flex-wrap items-center gap-x-2 gap-y-1 rounded-md border-l-[3px] px-2 py-1.5 hover:bg-zinc-100/80 md:min-h-[36px] md:flex-nowrap dark:hover:bg-zinc-800/60 ${
          task.important && !done ? 'border-amber-400 bg-amber-50/50 dark:border-amber-500 dark:bg-amber-500/10' : 'border-transparent'
        } ${selected ? 'bg-zinc-100/80 ring-2 ring-blue-500/50 ring-inset dark:bg-zinc-800/60' : ''}`}
        onClick={() => onOpen(task.id)}
        onContextMenu={onContextMenu}
      >
        <button
          className={`shrink-0 ${done ? 'text-emerald-500' : 'text-zinc-300 hover:text-emerald-500 dark:text-zinc-600'}`}
          onClick={e => {
            e.stopPropagation()
            toggleDone(task.id)
          }}
          title={done ? '완료 취소 (Space)' : '완료 (Space)'}
        >
          {done ? <SquareCheckBig size={17} /> : <Square size={17} />}
        </button>

        <span className={`min-w-0 flex-1 truncate text-[14.5px] ${done ? 'text-zinc-400 line-through dark:text-zinc-500' : task.important ? 'font-semibold text-amber-700 dark:text-amber-300' : ''}`}>
          {task.title}
        </span>

        {/* 날짜·프로젝트 등 — 모바일에선 제목 아래 줄로 줄바꿈(들여쓰기) */}
        <div className="flex shrink-0 items-center gap-2 max-md:order-last max-md:basis-full max-md:pl-[46px]">
          {task.deadline && !done && <DeadlineBadge deadline={task.deadline} />}
          <ScheduleChip task={task} selected={selected} />
          <ProjectControl task={task} selected={selected} />
          {/* 중요 토글 — 중요면 항상 노란 별, 아니면 hover/선택 시 토글 가능 */}
          <button
            className={`shrink-0 ${task.important ? 'text-amber-500' : `text-zinc-300 hover:text-amber-500 group-hover:visible touch:visible dark:text-zinc-600 ${selected ? 'visible' : 'invisible'}`}`}
            onClick={e => { e.stopPropagation(); updateTask(task.id, { important: !task.important }) }}
            title={task.important ? '중요 해제' : '중요 표시'}
          >
            <Star size={14} className={task.important ? 'fill-current' : ''} />
          </button>
          {trailing}
        </div>

        {/* 서브태스크 접기/펼치기 — 항상 맨 오른쪽 */}
        {ckTotal > 0 && <CollapseToggle collapsed={collapsed} selected={selected} onToggle={toggleCollapsed} />}
      </div>

      {task.checklist.length > 0 && !collapsed && (
        <Subtasks items={task.checklist} projectId={task.project_id} workspaceId={task.workspace_id} onChange={next => updateTask(task.id, { checklist: next })} />
      )}

      {addingSub && (
        <InlineSubAdd
          onAdd={(title, depth) => updateTask(task.id, { checklist: addCkAtDepth(task.checklist, depth, { id: nid('ck'), title, done: false, children: [] }) })}
          onClose={() => setAddSubFor(null)}
        />
      )}

      {ctxMenu}
    </div>
  )
}

/** 인라인 서브태스크 입력 — Enter 연속 추가, Tab 들여쓰기 / Shift+Tab 내어쓰기로 차원 이동, Esc 종료 */
export function InlineSubAdd({ onAdd, onClose }: { onAdd: (title: string, depth: number) => void; onClose: () => void }) {
  const [text, setText] = useState('')
  const [depth, setDepth] = useState(0)
  return (
    <div className="py-0.5 pr-2" style={{ paddingLeft: 46 + depth * 20 }} onClick={e => e.stopPropagation()}>
      <input
        autoFocus
        className="input !py-1 !text-[14px]"
        placeholder={depth > 0 ? `서브태스크 ${depth}단계 — Enter 추가 · Tab/Shift+Tab 단계 이동` : '서브태스크 — Enter 추가 · Tab 들여쓰기 · Esc 종료'}
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Tab') { e.preventDefault(); setDepth(d => e.shiftKey ? Math.max(0, d - 1) : Math.min(d + 1, 6)) }
          else if (e.key === 'Enter') { e.preventDefault(); const v = text.trim(); if (v) { onAdd(v, depth); setText('') } }
          else if (e.key === 'Escape') { e.preventDefault(); onClose() }
        }}
        onBlur={() => { const v = text.trim(); if (v) onAdd(v, depth); onClose() }}
      />
    </div>
  )
}

/* 서브태스크(체크리스트) 트리 조작 헬퍼 (id로 재귀) */
function toggleCk(items: ChecklistItem[], id: string): ChecklistItem[] {
  return items.map(c => ({ ...c, done: c.id === id ? !c.done : c.done, children: toggleCk(c.children, id) }))
}
function renameCk(items: ChecklistItem[], id: string, title: string): ChecklistItem[] {
  return items.map(c => ({ ...c, title: c.id === id ? title : c.title, children: renameCk(c.children, id, title) }))
}
function deleteCk(items: ChecklistItem[], id: string): ChecklistItem[] {
  return items.filter(c => c.id !== id).map(c => ({ ...c, children: deleteCk(c.children, id) }))
}
function addChildCk(items: ChecklistItem[], id: string, title: string): ChecklistItem[] {
  return items.map(c =>
    c.id === id
      ? { ...c, children: [...c.children, { id: nid('ck'), title, done: false, children: [] }] }
      : { ...c, children: addChildCk(c.children, id, title) },
  )
}
/** depth 단계만큼 들여써서 추가 — 각 단계의 마지막 항목 아래로 중첩(연속 추가 시 같은 레벨 유지). */
export function addCkAtDepth(items: ChecklistItem[], depth: number, item: ChecklistItem): ChecklistItem[] {
  if (depth <= 0 || items.length === 0) return [...items, item]
  const last = items[items.length - 1]
  return [...items.slice(0, -1), { ...last, children: addCkAtDepth(last.children, depth - 1, item) }]
}
/** parentId의 children에 depth 들여써서 추가 (서브태스크의 하위에 Shift+Enter로 추가) */
function addUnderCk(items: ChecklistItem[], parentId: string, depth: number, item: ChecklistItem): ChecklistItem[] {
  return items.map(c =>
    c.id === parentId
      ? { ...c, children: addCkAtDepth(c.children, depth, item) }
      : { ...c, children: addUnderCk(c.children, parentId, depth, item) },
  )
}
/** 들여쓰기 — 직전 형제의 자식으로 이동(맨 앞 항목은 불가). */
function indentCk(items: ChecklistItem[], id: string): ChecklistItem[] {
  const i = items.findIndex(c => c.id === id)
  if (i > 0) {
    const prev = items[i - 1]
    const next = [...items]
    next[i - 1] = { ...prev, children: [...prev.children, items[i]] }
    next.splice(i, 1)
    return next
  }
  return items.map(c => ({ ...c, children: indentCk(c.children, id) }))
}
/** 내어쓰기 — 부모의 형제(부모 바로 뒤)로 이동(최상위는 불가). */
function outdentCk(items: ChecklistItem[], id: string): ChecklistItem[] {
  for (let i = 0; i < items.length; i++) {
    const j = items[i].children.findIndex(c => c.id === id)
    if (j !== -1) {
      const moved = items[i].children[j]
      const next = [...items]
      next[i] = { ...items[i], children: items[i].children.filter(c => c.id !== id) }
      next.splice(i + 1, 0, moved)
      return next
    }
  }
  return items.map(c => ({ ...c, children: outdentCk(c.children, id) }))
}

export function Subtasks({ items, projectId, workspaceId, onChange, hideProjectTag }: { items: ChecklistItem[]; projectId: string | null; workspaceId: string | null; onChange: (next: ChecklistItem[]) => void; hideProjectTag?: boolean }) {
  // 태스크 행과 동일한 디자인 + 단계마다 세로 가이드 선/들여쓰기. 각 행은 우클릭 메뉴 + 부모 프로젝트 태그.
  // 자식 렌더링·접기는 SubtaskRow가 직접 담당(노드별 접힘 상태).
  return (
    <div className="mb-1 ml-3 border-l-2 border-zinc-200 pl-2 dark:border-zinc-700">
      {items.map(c => (
        <SubtaskRow key={c.id} item={c} root={items} projectId={projectId} workspaceId={workspaceId} onChange={onChange} hideProjectTag={hideProjectTag} />
      ))}
    </div>
  )
}

/** 서브태스크 한 줄 — 태스크 행과 같은 모양 + 우클릭 메뉴(완료·이름변경·하위추가·삭제) + 부모 프로젝트 태그 */
function SubtaskRow({ item, root, projectId, workspaceId, onChange, hideProjectTag }: { item: ChecklistItem; root: ChecklistItem[]; projectId: string | null; workspaceId: string | null; onChange: (next: ChecklistItem[]) => void; hideProjectTag?: boolean }) {
  const selected = useStore(s => s.hoverTaskId === item.id)
  const rowRef = useRef<HTMLDivElement>(null)
  useEffect(() => { if (selected) rowRef.current?.scrollIntoView({ block: 'nearest' }) }, [selected])
  const { onContextMenu, menu } = useContextMenu(close => (
    <>
      <MenuItem icon={item.done ? Square : SquareCheckBig} label={item.done ? '완료 취소' : '완료'} onClose={close} onPick={() => onChange(toggleCk(root, item.id))} />
      <MenuItem icon={Pencil} label="이름 변경" onClose={close} onPick={async () => { const v = await promptDialog({ title: '서브태스크 이름 변경', defaultValue: item.title, confirmLabel: '변경' }); if (v?.trim()) onChange(renameCk(root, item.id, v.trim())) }} />
      <MenuItem icon={ListPlus} label="하위 서브태스크 추가" onClose={close} onPick={async () => { const v = await promptDialog({ title: '하위 서브태스크', placeholder: '제목', confirmLabel: '추가' }); if (v?.trim()) onChange(addChildCk(root, item.id, v.trim())) }} />
      <MenuItem icon={IndentIncrease} label="들여쓰기 (Tab)" onClose={close} onPick={() => onChange(indentCk(root, item.id))} />
      <MenuItem icon={IndentDecrease} label="내어쓰기 (Shift+Tab)" onClose={close} onPick={() => onChange(outdentCk(root, item.id))} />
      <div className="my-1 h-px bg-zinc-100 dark:bg-zinc-800" />
      <MenuItem icon={Trash2} label="삭제" danger onClose={close} onPick={() => onChange(deleteCk(root, item.id))} />
    </>
  ))
  const addingChild = useStore(s => s.addSubFor === item.id)
  const setAddSubFor = useStore(s => s.setAddSubFor)
  const hasChildren = item.children.length > 0
  const [collapsed, toggleCollapsed] = useCollapsed(item.id)
  return (
    <>
      <div
        ref={rowRef}
        data-navid={item.id}
        className={`group flex min-h-[44px] items-center gap-2 rounded-md px-2 py-1.5 hover:bg-zinc-100/80 md:min-h-[36px] dark:hover:bg-zinc-800/60 ${
          selected ? 'bg-zinc-100/80 ring-2 ring-blue-500/50 ring-inset dark:bg-zinc-800/60' : ''
        }`}
        onClick={e => e.stopPropagation()}
        onContextMenu={onContextMenu}
      >
        <button
          className={`shrink-0 ${item.done ? 'text-emerald-500' : 'text-zinc-300 hover:text-emerald-500 dark:text-zinc-600'}`}
          onClick={() => onChange(toggleCk(root, item.id))}
          title={item.done ? '완료 취소' : '완료'}
        >
          {item.done ? <SquareCheckBig size={17} /> : <Square size={17} />}
        </button>
        <span className={`min-w-0 flex-1 truncate text-[14.5px] ${item.done ? 'text-zinc-400 line-through dark:text-zinc-500' : ''}`}>
          {item.title}
        </span>
        {!hideProjectTag && (projectId || workspaceId) && (
          <span className="shrink-0"><ProjectChip projectId={projectId} workspaceId={workspaceId} /></span>
        )}
        {hasChildren && <CollapseToggle collapsed={collapsed} selected={selected} onToggle={toggleCollapsed} />}
      </div>
      {hasChildren && !collapsed && (
        <div className="ml-3 border-l-2 border-zinc-200 pl-2 dark:border-zinc-700">
          {item.children.map(ch => (
            <SubtaskRow key={ch.id} item={ch} root={root} projectId={projectId} workspaceId={workspaceId} onChange={onChange} hideProjectTag={hideProjectTag} />
          ))}
        </div>
      )}
      {addingChild && (
        <div className="ml-3 border-l-2 border-zinc-200 pl-2 dark:border-zinc-700">
          <InlineSubAdd
            onAdd={(title, depth) => onChange(addUnderCk(root, item.id, depth, { id: nid('ck'), title, done: false, children: [] }))}
            onClose={() => setAddSubFor(null)}
          />
        </div>
      )}
      {menu}
    </>
  )
}

/** 일정 칩 — 날짜 있으면 상대 라벨(클릭=재일정), Someday면 "Someday", 없으면 hover 시 "Plan". 클릭 → PlanPopover */
function ScheduleChip({ task, selected }: { task: Task; selected?: boolean }) {
  const [open, setOpen] = useState(false)
  const has = !!task.scheduled_date || task.someday

  let content: string
  let tone: 'overdue' | 'today' | 'future' | 'someday' | 'plan'
  if (task.scheduled_date) {
    const d = daysFromToday(task.scheduled_date)
    content = d === 0 ? '오늘' : d === 1 ? '내일' : fmtDateShort(task.scheduled_date)
    tone = d < 0 ? 'overdue' : d === 0 ? 'today' : 'future'
  } else if (task.someday) {
    content = 'Someday'; tone = 'someday'
  } else {
    content = 'Plan'; tone = 'plan'
  }

  // 모노톤 — 연체만 옅은 빨강으로 신호, 나머지는 중립 zinc
  const toneCls = {
    overdue: 'text-red-400 hover:bg-zinc-100 dark:text-red-400/90 dark:hover:bg-zinc-800',
    today: 'text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800',
    future: 'text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800',
    someday: 'text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800',
    plan: 'text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200',
  }[tone]
  // 날짜·Someday·Plan 모두 hover/선택 시에만 노출 (터치 기기에선 항상 노출)
  const vis = `group-hover:visible touch:visible ${selected ? 'visible' : 'invisible'}`

  return (
    <span className="relative shrink-0" onClick={e => e.stopPropagation()}>
      <button
        className={`flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] font-medium transition-colors ${toneCls} ${vis}`}
        title="일정 변경"
        onClick={() => setOpen(o => !o)}
      >
        {!has && <CalendarDays size={12} className="shrink-0" />}
        <span>{content}</span>
      </button>
      {open && <PlanPopover task={task} onClose={() => setOpen(false)} />}
    </span>
  )
}

/** 프로젝트 칩 — 있으면 ProjectChip(클릭=변경), 없으면 hover 시 "프로젝트". 클릭 → 프로젝트 선택 팝오버 */
function ProjectControl({ task, selected }: { task: Task; selected?: boolean }) {
  const [open, setOpen] = useState(false)
  const projects = useStore(s => s.projects)
  const workspaces = useStore(s => s.workspaces)
  const updateTask = useStore(s => s.updateTask)
  const has = !!task.project_id || !!task.workspace_id
  const vis = has ? '' : `group-hover:visible touch:visible ${selected ? 'visible' : 'invisible'}`

  return (
    <span className="relative shrink-0" onClick={e => e.stopPropagation()}>
      <button
        className={`flex shrink-0 items-center rounded-md ${has ? 'hover:opacity-80' : 'gap-1 px-1.5 py-0.5 text-[12px] font-medium text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200'} ${vis}`}
        title="프로젝트 변경"
        onClick={() => setOpen(o => !o)}
      >
        {has ? <ProjectChip projectId={task.project_id} workspaceId={task.workspace_id} /> : <><FolderInput size={12} className="shrink-0" />프로젝트</>}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onMouseDown={() => setOpen(false)} />
          <div className="absolute top-7 right-0 z-50 max-h-[320px] w-[220px] max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-lg border border-zinc-200 bg-white p-1 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
            <button
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-zinc-100 dark:hover:bg-zinc-800 ${!task.project_id ? 'bg-zinc-100 font-semibold dark:bg-zinc-800' : ''}`}
              onClick={() => { updateTask(task.id, { project_id: null, workspace_id: null }); setOpen(false) }}
            >
              <CircleSlash size={14} className="shrink-0 text-zinc-400" />
              <span className="flex-1">프로젝트 없음</span>
            </button>
            {workspaces.map(w => {
              const ps = projects.filter(p => p.workspace_id === w.id)
              const wsActive = task.workspace_id === w.id && !task.project_id
              return (
                <div key={w.id}>
                  <button
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] font-semibold hover:bg-zinc-100 dark:hover:bg-zinc-800 ${wsActive ? 'bg-zinc-100 dark:bg-zinc-800' : ''}`}
                    onClick={() => { updateTask(task.id, { workspace_id: w.id, project_id: null }); setOpen(false) }}
                  >
                    <span className="h-2.5 w-2.5 shrink-0 rounded-[4px]" style={{ background: wsColor(w.id, workspaces) }} />
                    <span className="flex-1 truncate">{w.name}</span>
                  </button>
                  {ps.map(p => (
                    <button
                      key={p.id}
                      className={`flex w-full items-center gap-2 rounded-md py-1.5 pr-2 pl-6 text-left text-[13px] hover:bg-zinc-100 dark:hover:bg-zinc-800 ${task.project_id === p.id ? 'bg-zinc-100 font-semibold dark:bg-zinc-800' : ''}`}
                      onClick={() => { updateTask(task.id, { project_id: p.id, workspace_id: w.id }); setOpen(false) }}
                    >
                      <span className="h-2 w-2 shrink-0 rounded-[3px]" style={{ background: projectColor(p.id, projects) }} />
                      <span className="flex-1 truncate">{p.title}</span>
                    </button>
                  ))}
                </div>
              )
            })}
          </div>
        </>
      )}
    </span>
  )
}

export function DeadlineBadge({ deadline }: { deadline: string }) {
  const d = daysFromToday(deadline)
  const cls =
    d < 0
      ? 'border-red-200 bg-red-50 text-red-600 dark:border-red-900 dark:bg-red-950 dark:text-red-400'
      : d <= 3
        ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400'
        : 'border-zinc-200 bg-zinc-50 text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800/70 dark:text-zinc-400'
  const label = d < 0 ? `마감 ${-d}일 지남` : d === 0 ? '오늘 마감' : `D-${d}`
  return (
    <span className={`shrink-0 rounded-full border px-1.5 py-px text-[12px] font-semibold ${cls}`} title={`마감일 ${deadline}`}>
      {label}
    </span>
  )
}

function countCk(items: { done: boolean; children: unknown[] }[], onlyDone = false): number {
  let n = 0
  for (const c of items) {
    if (!onlyDone || c.done) n++
    n += countCk(c.children as { done: boolean; children: unknown[] }[], onlyDone)
  }
  return n
}
