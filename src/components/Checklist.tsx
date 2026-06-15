import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import type { ChecklistItem } from '../types'
import { nid } from '../store/store'

/* ───── 불변 트리 헬퍼 ───── */
function mapTree(items: ChecklistItem[], fn: (c: ChecklistItem) => ChecklistItem): ChecklistItem[] {
  return items.map(c => fn({ ...c, children: mapTree(c.children, fn) }))
}
function removeFromTree(items: ChecklistItem[], id: string): ChecklistItem[] {
  return items.filter(c => c.id !== id).map(c => ({ ...c, children: removeFromTree(c.children, id) }))
}
function insertChild(items: ChecklistItem[], parentId: string | null, item: ChecklistItem): ChecklistItem[] {
  if (parentId === null) return [...items, item]
  return items.map(c =>
    c.id === parentId ? { ...c, children: [...c.children, item] } : { ...c, children: insertChild(c.children, parentId, item) },
  )
}
function findParentId(items: ChecklistItem[], id: string, parent: string | null = null): string | null | undefined {
  for (const c of items) {
    if (c.id === id) return parent
    const r = findParentId(c.children, id, c.id)
    if (r !== undefined) return r
  }
  return undefined
}
function siblingsOf(items: ChecklistItem[], parentId: string | null): ChecklistItem[] {
  if (parentId === null) return items
  const stack = [...items]
  while (stack.length) {
    const c = stack.pop()!
    if (c.id === parentId) return c.children
    stack.push(...c.children)
  }
  return []
}

interface AddState {
  parentId: string | null
  text: string
}

export default function Checklist({
  items,
  onChange,
}: {
  items: ChecklistItem[]
  onChange: (next: ChecklistItem[]) => void
}) {
  const [add, setAdd] = useState<AddState | null>(null)
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)

  const commitAdd = (keepOpen: boolean) => {
    if (!add) return
    const text = add.text.trim()
    if (text) {
      onChange(insertChild(items, add.parentId, { id: nid('ck'), title: text, done: false, children: [] }))
    }
    setAdd(keepOpen ? { parentId: add.parentId, text: '' } : null)
  }

  const onAddKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!add) return
    if (e.key === 'Enter') {
      e.preventDefault()
      commitAdd(true)
    } else if (e.key === 'Escape') {
      setAdd(null)
    } else if (e.key === 'Tab') {
      e.preventDefault()
      if (e.shiftKey) {
        // 한 레벨 위로
        if (add.parentId === null) return
        const gp = findParentId(items, add.parentId)
        if (gp !== undefined) setAdd({ parentId: gp, text: add.text })
      } else {
        // 바로 위 항목의 자식으로
        const sibs = siblingsOf(items, add.parentId)
        if (sibs.length > 0) setAdd({ parentId: sibs[sibs.length - 1].id, text: add.text })
      }
    }
  }

  const commitEdit = () => {
    if (!editing) return
    const text = editing.text.trim()
    if (text) onChange(mapTree(items, c => (c.id === editing.id ? { ...c, title: text } : c)))
    setEditing(null)
  }

  const renderItems = (list: ChecklistItem[], depth: number) => (
    <>
      {list.map(c => (
        <div key={c.id}>
          <div className="group flex items-start gap-1.5 rounded px-1 py-[3px] hover:bg-zinc-50 dark:hover:bg-zinc-800/50" style={{ marginLeft: depth * 16 }}>
            <input
              type="checkbox"
              checked={c.done}
              onChange={() => onChange(mapTree(items, x => (x.id === c.id ? { ...x, done: !x.done } : x)))}
              className="mt-[3px] h-3.5 w-3.5 shrink-0 cursor-pointer accent-emerald-500"
            />
            {editing?.id === c.id ? (
              <input
                autoFocus
                className="input !py-0.5 !text-[13.5px]"
                value={editing.text}
                onChange={e => setEditing({ id: c.id, text: e.target.value })}
                onBlur={commitEdit}
                onKeyDown={e => {
                  if (e.key === 'Enter') commitEdit()
                  if (e.key === 'Escape') setEditing(null)
                }}
              />
            ) : (
              <span
                className={`flex-1 cursor-text text-[13.5px] leading-[1.45] ${c.done ? 'text-zinc-400 line-through dark:text-zinc-500' : ''}`}
                onClick={() => setEditing({ id: c.id, text: c.title })}
              >
                {c.title}
              </span>
            )}
            <button
              className="invisible rounded p-0.5 text-zinc-400 group-hover:visible hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-700"
              title="하위 항목"
              onClick={() => setAdd({ parentId: c.id, text: '' })}
            >
              <Plus size={12} />
            </button>
            <button
              className="invisible rounded p-0.5 text-zinc-400 group-hover:visible hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950"
              title="삭제"
              onClick={() => onChange(removeFromTree(items, c.id))}
            >
              <X size={12} />
            </button>
          </div>
          {add?.parentId === c.id && (
            <div style={{ marginLeft: (depth + 1) * 16 }} className="py-0.5 pr-6">
              <input
                autoFocus
                className="input !py-1 !text-[13.5px]"
                placeholder="하위 항목 — Enter 추가 · Tab 들여쓰기 · Shift+Tab 내어쓰기"
                value={add.text}
                onChange={e => setAdd({ ...add, text: e.target.value })}
                onKeyDown={onAddKey}
                onBlur={() => commitAdd(false)}
              />
            </div>
          )}
          {renderItems(c.children, depth + 1)}
        </div>
      ))}
    </>
  )

  return (
    <div>
      {renderItems(items, 0)}
      {add?.parentId === null && (
        <div className="py-0.5 pr-6">
          <input
            autoFocus
            className="input !py-1 !text-[13.5px]"
            placeholder="서브태스크 — Enter 추가 · Tab 들여쓰기"
            value={add.text}
            onChange={e => setAdd({ ...add, text: e.target.value })}
            onKeyDown={onAddKey}
            onBlur={() => commitAdd(false)}
          />
        </div>
      )}
      {add === null && (
        <button
          onClick={() => setAdd({ parentId: null, text: '' })}
          className="mt-0.5 flex items-center gap-1 rounded px-1 py-0.5 text-[13px] font-medium text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400"
        >
          <Plus size={12} /> 서브태스크
        </button>
      )}
    </div>
  )
}
