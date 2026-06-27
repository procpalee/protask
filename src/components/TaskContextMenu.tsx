import { type MouseEvent, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Pencil, SquareCheckBig, Square, Star, ListPlus, Trash2 } from 'lucide-react'
import { useStore } from '../store/store'
import type { Task } from '../types'

/* ───────────────────────── 공용 우클릭 메뉴 ───────────────────────── */

/** 메뉴 항목 버튼 — onPick 후 자동으로 메뉴를 닫는다. */
export function MenuItem({ icon: Icon, label, onPick, onClose, danger }: {
  icon: typeof Pencil
  label: string
  onPick: () => void
  onClose: () => void
  danger?: boolean
}) {
  return (
    <button
      className={`flex w-full items-center gap-2.5 rounded px-2.5 py-1.5 text-left text-[13.5px] ${
        danger ? 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40' : 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800'
      }`}
      onClick={() => { onPick(); onClose() }}
    >
      <Icon size={14} className="shrink-0" /> {label}
    </button>
  )
}

/** 커서 위치에 뜨는 메뉴 박스 — 뷰포트 보정 + Esc/스크롤/바깥클릭 닫기. */
function ContextMenuShell({ x, y, onClose, children }: { x: number; y: number; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos({
      x: x + r.width > window.innerWidth - 8 ? Math.max(8, window.innerWidth - r.width - 8) : x,
      y: y + r.height > window.innerHeight - 8 ? Math.max(8, window.innerHeight - r.height - 8) : y,
    })
  }, [x, y])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onClose, true)
    window.addEventListener('resize', onClose)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onClose, true)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} onContextMenu={e => { e.preventDefault(); onClose() }} />
      <div
        ref={ref}
        className="fixed z-50 w-[200px] rounded-lg border border-zinc-200 bg-white p-1 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
        style={{ left: pos.x, top: pos.y }}
        onContextMenu={e => e.preventDefault()}
      >
        {children}
      </div>
    </>
  )
}

/** 우클릭 메뉴 훅 — render(close)로 메뉴 내용을 그린다. onContextMenu를 대상 요소에, menu를 형제로 렌더. */
export function useContextMenu(render: (close: () => void) => ReactNode) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const close = () => setPos(null)
  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setPos({ x: e.clientX, y: e.clientY })
  }
  const menu = pos ? <ContextMenuShell x={pos.x} y={pos.y} onClose={close}>{render(close)}</ContextMenuShell> : null
  return { onContextMenu, menu }
}

/* ───────────────────────── 태스크 행/카드용 메뉴 ───────────────────────── */

/** 태스크 우클릭 메뉴 — 수정·완료·중요·서브태스크 추가·삭제. 삭제는 즉시(Ctrl+Z로 복원). */
export function useTaskContextMenu(task: Task, onOpen: (id: string) => void) {
  const toggleDone = useStore(s => s.toggleDone)
  const updateTask = useStore(s => s.updateTask)
  const deleteTask = useStore(s => s.deleteTask)
  const setAddSubFor = useStore(s => s.setAddSubFor)
  const done = task.status === 'done'
  const flash = (m: string) => window.dispatchEvent(new CustomEvent('pd:flash', { detail: m }))

  return useContextMenu(close => (
    <>
      <MenuItem icon={Pencil} label="수정 (상세 열기)" onClose={close} onPick={() => onOpen(task.id)} />
      <MenuItem icon={done ? Square : SquareCheckBig} label={done ? '완료 취소' : '완료'} onClose={close} onPick={() => toggleDone(task.id)} />
      <MenuItem icon={Star} label={task.important ? '중요 해제' : '중요 표시'} onClose={close} onPick={() => updateTask(task.id, { important: !task.important })} />
      <MenuItem icon={ListPlus} label="서브태스크 추가" onClose={close} onPick={() => setAddSubFor(task.id)} />
      <div className="my-1 h-px bg-zinc-100 dark:bg-zinc-800" />
      <MenuItem icon={Trash2} label="삭제" danger onClose={close} onPick={() => { deleteTask(task.id); flash(`삭제됨: ${task.title} — Ctrl+Z로 복원`) }} />
    </>
  ))
}
