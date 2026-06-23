import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Pencil, CheckCircle2, Circle, Star, ListPlus, Trash2 } from 'lucide-react'
import { useStore } from '../store/store'
import type { Task } from '../types'

/** 태스크 우클릭 컨텍스트 메뉴 — 수정(상세)·완료·중요·서브태스크·삭제. 삭제는 즉시(Ctrl+Z로 복원). */
export default function TaskContextMenu({
  task,
  x,
  y,
  onOpen,
  onClose,
}: {
  task: Task
  x: number
  y: number
  onOpen: (id: string) => void
  onClose: () => void
}) {
  const toggleDone = useStore(s => s.toggleDone)
  const updateTask = useStore(s => s.updateTask)
  const deleteTask = useStore(s => s.deleteTask)
  const setAddSubFor = useStore(s => s.setAddSubFor)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })

  // 메뉴가 화면 밖으로 넘치지 않게 위치 보정
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos({
      x: x + r.width > window.innerWidth - 8 ? Math.max(8, window.innerWidth - r.width - 8) : x,
      y: y + r.height > window.innerHeight - 8 ? Math.max(8, window.innerHeight - r.height - 8) : y,
    })
  }, [x, y])

  // Esc·스크롤·리사이즈 시 닫기
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

  const done = task.status === 'done'
  const flash = (m: string) => window.dispatchEvent(new CustomEvent('pd:flash', { detail: m }))
  const run = (fn: () => void) => () => { fn(); onClose() }

  const Item = ({ icon: Icon, label, onPick, danger }: { icon: typeof Pencil; label: string; onPick: () => void; danger?: boolean }) => (
    <button
      className={`flex w-full items-center gap-2.5 rounded px-2.5 py-1.5 text-left text-[13.5px] ${
        danger ? 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40' : 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800'
      }`}
      onClick={run(onPick)}
    >
      <Icon size={14} className="shrink-0" /> {label}
    </button>
  )

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} onContextMenu={e => { e.preventDefault(); onClose() }} />
      <div
        ref={ref}
        className="fixed z-50 w-[200px] rounded-lg border border-zinc-200 bg-white p-1 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
        style={{ left: pos.x, top: pos.y }}
        onContextMenu={e => e.preventDefault()}
      >
        <Item icon={Pencil} label="수정 (상세 열기)" onPick={() => onOpen(task.id)} />
        <Item icon={done ? Circle : CheckCircle2} label={done ? '완료 취소' : '완료'} onPick={() => toggleDone(task.id)} />
        <Item icon={Star} label={task.important ? '중요 해제' : '중요 표시'} onPick={() => updateTask(task.id, { important: !task.important })} />
        <Item icon={ListPlus} label="서브태스크 추가" onPick={() => setAddSubFor(task.id)} />
        <div className="my-1 h-px bg-zinc-100 dark:bg-zinc-800" />
        <Item icon={Trash2} label="삭제" danger onPick={() => { deleteTask(task.id); flash(`삭제됨: ${task.title} — Ctrl+Z로 복원`) }} />
      </div>
    </>
  )
}
