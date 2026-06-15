import { useEffect, useRef, useState } from 'react'
import { Zap } from 'lucide-react'
import { useStore } from '../store/store'
import { parseQuick, fmtDate } from '../lib/dates'

/** Ctrl/Cmd+K 전역 빠른 캡처 → Inbox (한국어 날짜 토큰 인식) */
export default function QuickCapture() {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const addTask = useStore(s => s.addTask)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(o => !o)
      }
      if (e.key === 'Escape') { setOpen(false); setText('') }
    }
    const onOpen = () => setOpen(true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('pd:capture-open', onOpen)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pd:capture-open', onOpen)
    }
  }, [])

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 30)
  }, [open])

  if (!open) return null

  const parsed = parseQuick(text)

  const submit = () => {
    if (!parsed.title) return
    addTask({ title: parsed.title, scheduled_date: parsed.date })
    setText('')
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/30 p-4 pt-[18vh] backdrop-blur-[1px]"
      onMouseDown={e => {
        if (e.target === e.currentTarget) { setOpen(false); setText('') }
      }}
    >
      <div className="w-full max-w-[560px] overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
        <div className="flex items-center gap-2.5 px-4 py-3">
          <Zap size={16} className="shrink-0 text-blue-500" />
          <input
            ref={inputRef}
            className="flex-1 bg-transparent text-[14.5px] outline-none placeholder:text-zinc-400"
            placeholder="빠른 캡처 — Enter로 Inbox에 추가  (예: 부가세 신고 내일)"
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') submit()
            }}
          />
        </div>
        <div className="flex items-center justify-between border-t border-zinc-100 bg-zinc-50 px-4 py-2 text-[11.5px] text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900/60">
          <span>
            {parsed.date
              ? <>실행일 <b className="text-blue-600 dark:text-blue-400">{fmtDate(parsed.date)}</b> · "{parsed.title}"</>
              : '날짜 토큰: 오늘 · 내일 · 모레 · 금요일 · 다음주 월 · 6월 30일'}
          </span>
          <span>Enter 추가 · Esc 닫기</span>
        </div>
      </div>
    </div>
  )
}
