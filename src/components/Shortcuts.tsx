import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Modal from './Modal'
import { useStore } from '../store/store'
import { todayStr } from '../lib/dates'

/**
 * 전역 단축키.
 *  선택 없음:  1~5 뷰 이동(Inbox/Today/Scheduled/Someday/Calendar) · → 할일 입력칸 포커스(없으면 첫 태스크) · Enter 첫 태스크 선택
 *  할일 입력칸: ↓ 첫 태스크 선택 · ↑(첫 태스크에서) 입력칸 복귀 · Esc 입력 해제 · Enter 작성
 *  태스크 선택: ↑/↓ 이동 · ←/Esc 해제 · T 오늘 · S 날짜선택 · Y Someday · P 프로젝트 · D 마감일 · I Inbox · Space 완료 · Enter 상세 · Del 삭제
 *  ←/→ 탭 전환(워크스페이스·프로젝트) · Backspace 뒤로가기
 *  Alt+1~5 뷰 직접이동 · Alt+Shift+1~9 워크스페이스 · Ctrl+K 캡처 · Ctrl+Z 실행취소 · ? 도움말
 */
export const SHORTCUTS: { keys: string; desc: string }[] = [
  { keys: '1~5', desc: '뷰 이동: Inbox·Today·Upcoming·Someday·Calendar' },
  { keys: '↑ / ↓', desc: '선택 태스크 이동 / 탭 화면(워크·프로젝트) 항목 선택' },
  { keys: '→', desc: '뷰에서: 할일 입력칸 포커스(Inbox/Today/Someday) · 없으면 첫 태스크' },
  { keys: '↑ / ↓', desc: '할일 입력칸 ↔ 첫 태스크 (↓ 진입 · ↑ 복귀) · Esc 입력 해제' },
  { keys: 'Enter', desc: '뷰에서: 첫 태스크 선택' },
  { keys: '← / Esc', desc: '선택 해제' },
  { keys: '→ / ←', desc: '선택 태스크: 퀵액션 포커스 이동 · Enter 적용' },
  { keys: '1~6', desc: '선택 태스크: Inbox·Today·Scheduled·Someday·Project·Deadline' },
  { keys: '0', desc: '선택 태스크: 중요 표시 토글' },
  { keys: 'T', desc: '선택 태스크: 오늘(Today)' },
  { keys: 'S', desc: '선택 태스크: 실행일 날짜 선택(Schedule)' },
  { keys: 'Y', desc: '선택 태스크: Someday(언젠가)' },
  { keys: 'P', desc: '선택 태스크: 프로젝트 선택' },
  { keys: 'D', desc: '선택 태스크: 마감일(Deadline)' },
  { keys: 'I', desc: '선택 태스크: Inbox로 (날짜·Someday 해제)' },
  { keys: 'Space', desc: '선택 태스크: 완료 토글' },
  { keys: 'Enter', desc: '선택 태스크: 상세 팝업' },
  { keys: 'Shift Enter', desc: '선택 태스크: 서브태스크 추가(인라인)' },
  { keys: 'Del', desc: '선택 태스크: 삭제 (Ctrl+Z 복원)' },
  { keys: '← / →', desc: '워크스페이스·프로젝트: 탭 전환 (선택 없을 때)' },
  { keys: 'Backspace', desc: '뒤로가기' },
  { keys: 'W / M', desc: '캘린더: 주간 / 월간 전환' },
  { keys: 'Alt + Shift + 1~9', desc: '워크스페이스 이동' },
  { keys: 'Ctrl K', desc: '빠른 캡처 (Inbox)' },
  { keys: 'Ctrl Z', desc: '실행취소' },
  { keys: 'Tab / Shift Tab', desc: '서브태스크: 들여쓰기 / 내어쓰기' },
  { keys: '?', desc: '단축키 도움말' },
]

const VIEW_PATHS = ['/inbox', '/', '/upcoming', '/someday', '/calendar']
const NAV_BY_DIGIT: Record<string, string> = { '1': '/inbox', '2': '/', '3': '/upcoming', '4': '/someday', '5': '/calendar' }

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable
}

export default function Shortcuts() {
  const navigate = useNavigate()
  const [help, setHelp] = useState(false)
  const dateRef = useRef<HTMLInputElement>(null)
  const pendingDate = useRef<{ id: string; field: 'scheduled_date' | 'deadline' } | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const store = useStore.getState()

      // Ctrl+Z
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !isTyping(e)) {
        e.preventDefault()
        const msg = store.undo()
        window.dispatchEvent(new CustomEvent('pd:flash', { detail: msg ?? '되돌릴 작업이 없습니다' }))
        return
      }
      // Alt+Shift+1~9: 워크스페이스
      if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey && /^Digit[1-9]$/.test(e.code) && !isTyping(e)) {
        const ws = store.workspaces[Number(e.code.slice(5)) - 1]
        if (ws) { e.preventDefault(); navigate(`/w/${ws.id}`) }
        return
      }
      // Alt+1~5: 뷰 이동
      if (e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey && /^Digit[1-5]$/.test(e.code) && !isTyping(e)) {
        e.preventDefault()
        navigate(NAV_BY_DIGIT[e.code.slice(5)])
        return
      }

      // 할일 입력칸 포커스 상태 처리
      {
        const el = e.target as HTMLElement
        if (el?.matches?.('[data-capture]')) {
          // ↓ → 첫 태스크 선택 (입력 → 목록 탐색 전환)
          if (e.key === 'ArrowDown' && store.navOrder.length) {
            e.preventDefault()
            el.blur()
            store.setHoverTask(store.navOrder[0])
            return
          }
          // Esc → 입력칸 선택 해제
          if (e.key === 'Escape') {
            e.preventDefault()
            ;(el as HTMLInputElement).blur()
            return
          }
        }
      }

      if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return

      // Backspace : 뒤로가기 (입력 중은 위에서 이미 제외)
      if (e.key === 'Backspace') { e.preventDefault(); navigate(-1); return }

      const hover = store.hoverTaskId
      const hasSel = !!hover && !store.detailTaskId
      const k = e.key.toLowerCase()
      const hoverIsSubtask = !!hover && !store.tasks.some(t => t.id === hover) // 선택된 게 서브태스크(체크리스트)인지

      /* ───── 뷰 이동 모드 (선택 없음) ───── */
      if (!hasSel && !store.detailTaskId) {
        // 1~5 : 좌측 사이드패널 뷰 직접 이동 (방향키 뷰 이동 대체)
        if (/^[1-5]$/.test(e.key)) { e.preventDefault(); navigate(VIEW_PATHS[Number(e.key) - 1]); return }
        // ←/→ : 탭 전환 (워크스페이스·프로젝트 화면)
        if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && store.tabNav) {
          e.preventDefault()
          const { keys, active, set } = store.tabNav
          const i = keys.indexOf(active)
          const ni = e.key === 'ArrowRight' ? Math.min(keys.length - 1, i + 1) : Math.max(0, i - 1)
          if (ni !== i) set(keys[ni])
          return
        }
        // ↑/↓ : 탭 화면에서 오른쪽 콘텐츠 첫/마지막 항목 선택 (뷰 간 이동은 1~5로 대체·제거)
        if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && store.tabNav && store.navOrder.length) {
          e.preventDefault()
          store.setHoverTask(e.key === 'ArrowDown' ? store.navOrder[0] : store.navOrder[store.navOrder.length - 1])
          return
        }
        // → : 할일 입력칸으로 포커스 (Inbox/Today/Someday). 입력칸 없으면 첫 태스크 선택
        if (e.key === 'ArrowRight') {
          const cap = document.querySelector<HTMLInputElement>('[data-capture]')
          if (cap) { e.preventDefault(); cap.focus(); return }
          if (store.navOrder.length) { e.preventDefault(); store.setHoverTask(store.navOrder[0]) }
          return
        }
        // Enter : 첫 태스크 선택 (입력칸 없는 뷰 포함)
        if (e.key === 'Enter' && store.navOrder.length) {
          e.preventDefault()
          store.setHoverTask(store.navOrder[0])
          return
        }
        if (e.key === '?') { e.preventDefault(); setHelp(h => !h) }
        return
      }

      /* ───── 태스크 선택 모드 ───── */
      // Shift+Enter : 선택 태스크에 서브태스크 인라인 추가(상세 열지 않음). plain Enter보다 먼저 처리.
      if (e.key === 'Enter' && e.shiftKey && store.navKind === 'task') {
        e.preventDefault()
        store.setAddSubFor(hover!)
        return
      }
      // 워크스페이스·프로젝트(탭 화면): ←/→ 가로 이동, ↑/↓ 격자 위아래, Esc 사이드바 포커스
      if (store.tabNav) {
        if (e.key === 'ArrowRight') { e.preventDefault(); store.moveHover(1); return }
        if (e.key === 'ArrowLeft') { e.preventDefault(); store.moveHover(-1); return }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault()
          const down = e.key === 'ArrowDown'
          const h = hover!
          const cur = document.querySelector<HTMLElement>(`[data-navid="${h}"]`)
          if (!cur) { store.moveHover(down ? 1 : -1); return }
          const cr = cur.getBoundingClientRect()
          const cx = cr.left + cr.width / 2
          let best: string | null = null
          let bestScore = Infinity
          for (const id of store.navOrder) {
            if (id === h) continue
            const el = document.querySelector<HTMLElement>(`[data-navid="${id}"]`)
            if (!el) continue
            const r = el.getBoundingClientRect()
            if (down ? r.top <= cr.top + 4 : r.top >= cr.top - 4) continue
            const score = Math.abs(r.left + r.width / 2 - cx) + Math.abs(r.top - cr.top) * 0.3
            if (score < bestScore) { bestScore = score; best = id }
          }
          if (best) store.setHoverTask(best)
          return
        }
        if (e.key === 'Escape') { e.preventDefault(); store.setHoverTask(null); return } // 선택 해제 → 탭 포커스
        // Enter/기타는 아래 공통 처리 (project=이동, task=상세/완료)
      }

      // 선택 태스크 퀵액션 (리스트 뷰): → 다음 · ← 이전(맨앞에서 선택 해제) · 1~6 직접 · Enter 적용
      if (!store.tabNav && store.navKind === 'task' && !hoverIsSubtask) {
        const QN = 6 // Inbox · Today · Scheduled · Someday · Project · Deadline
        const applyQuick = (i: number) => {
          store.setQuickFocus(-1)
          if (i === 0) store.updateTask(hover!, { scheduled_date: null, someday: false })
          else if (i === 1) store.updateTask(hover!, { scheduled_date: todayStr() })
          else if (i === 2) openPicker('scheduled_date')
          else if (i === 3) store.updateTask(hover!, { someday: true })
          else if (i === 4) store.openDetail(hover!)
          else if (i === 5) openPicker('deadline')
        }
        if (e.key === 'ArrowRight') { e.preventDefault(); store.setQuickFocus((store.quickFocus + 1) % QN); return }
        if (e.key === 'ArrowLeft') {
          e.preventDefault()
          if (store.quickFocus > 0) store.setQuickFocus(store.quickFocus - 1)
          else if (store.quickFocus === 0) store.setQuickFocus(-1)
          else store.setHoverTask(null)
          return
        }
        if (e.key === 'Enter' && store.quickFocus >= 0) { e.preventDefault(); applyQuick(store.quickFocus); return }
        if (e.key === 'Escape' && store.quickFocus >= 0) { e.preventDefault(); store.setQuickFocus(-1); return }
        if (/^[1-6]$/.test(e.key)) { e.preventDefault(); applyQuick(Number(e.key) - 1); return }
      }

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const idx = store.navOrder.indexOf(hover!)
        if (e.key === 'ArrowUp' && idx === 0) {
          // 맨 위 태스크에서 ↑ : 할일 입력칸이 있으면 그쪽으로, 없으면 뷰 이동 모드로
          const cap = document.querySelector<HTMLInputElement>('[data-capture]')
          store.setHoverTask(null)
          if (cap) cap.focus()
        } else store.moveHover(e.key === 'ArrowDown' ? 1 : -1)
        return
      }
      if (e.key === 'ArrowLeft' || e.key === 'Escape') {
        e.preventDefault()
        store.setHoverTask(null)
        return
      }

      /* 프로젝트 선택 모드: Enter=프로젝트 이동, 태스크 전용 키 비활성 */
      if (store.navKind === 'project') {
        if (e.key === 'Enter') {
          e.preventDefault()
          const p = store.projects.find(x => x.id === hover)
          if (p) navigate(`/w/${p.workspace_id}/p/${p.id}`)
        }
        return
      }

      /* 서브태스크(체크리스트 항목) 선택 시 — 완료(Space)/삭제(Delete)만, 그 외 태스크 전용 키 무시 */
      if (hoverIsSubtask) {
        if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); store.toggleChecklistItem(hover!); return }
        if (e.key === 'Delete') {
          e.preventDefault()
          const order = store.navOrder
          const idx = order.indexOf(hover!)
          store.deleteChecklistItem(hover!)
          const nextId = order[idx + 1] ?? order[idx - 1] ?? null
          store.setHoverTask(nextId && nextId !== hover ? nextId : null)
          return
        }
        if (e.key === 'Enter') { e.preventDefault(); return } // 서브태스크엔 상세 없음
        return
      }

      if (e.key === 'Enter') { e.preventDefault(); store.openDetail(hover!); return }
      if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); store.toggleDone(hover!); return }
      if (e.key === 'Delete') {
        e.preventDefault()
        const id = hover!
        const t = store.tasks.find(x => x.id === id)
        const order = store.navOrder
        const idx = order.indexOf(id)
        store.deleteTask(id)
        const nextId = order[idx + 1] ?? order[idx - 1] ?? null
        store.setHoverTask(nextId && nextId !== id ? nextId : null)
        window.dispatchEvent(new CustomEvent('pd:flash', { detail: t ? `삭제: ${t.title} (Ctrl+Z로 복원)` : '삭제됨' }))
        return
      }

      // 직관 letter 단축키 (function 선언 → 위쪽 퀵액션 블록에서도 호출 가능)
      function openPicker(field: 'scheduled_date' | 'deadline') {
        const t = store.tasks.find(x => x.id === hover)
        pendingDate.current = { id: hover!, field }
        const input = dateRef.current
        if (input) {
          input.value = (field === 'deadline' ? t?.deadline : t?.scheduled_date) ?? todayStr()
          try { input.showPicker() } catch { input.focus() }
        }
      }
      if (k === 't') { e.preventDefault(); store.updateTask(hover!, { scheduled_date: todayStr() }); return }
      if (k === 's') { e.preventDefault(); openPicker('scheduled_date'); return }
      if (k === 'y') { e.preventDefault(); store.updateTask(hover!, { someday: true }); return }
      if (k === 'p') { e.preventDefault(); store.openDetail(hover!); return }
      if (k === 'd') { e.preventDefault(); openPicker('deadline'); return }
      if (k === 'i') { e.preventDefault(); store.updateTask(hover!, { scheduled_date: null, someday: false }); return }
      if (e.key === '0') { e.preventDefault(); const cur = store.tasks.find(x => x.id === hover); store.updateTask(hover!, { important: !cur?.important }); return }
      if (e.key === '?') { e.preventDefault(); setHelp(h => !h) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate])

  return (
    <>
      <input
        ref={dateRef}
        type="date"
        className="pointer-events-none fixed -left-[9999px] opacity-0"
        tabIndex={-1}
        onChange={e => {
          const p = pendingDate.current
          if (p && e.target.value) useStore.getState().updateTask(p.id, { [p.field]: e.target.value })
          pendingDate.current = null
        }}
      />
      {help && (
        <Modal title="단축키" onClose={() => setHelp(false)} width={440}>
          <div className="space-y-1">
            {SHORTCUTS.map(s => (
              <div key={s.keys + s.desc} className="flex items-center justify-between gap-3 rounded px-1.5 py-1 hover:bg-zinc-50 dark:hover:bg-zinc-800/60">
                <span className="text-[13.5px] text-zinc-600 dark:text-zinc-300">{s.desc}</span>
                <span className="flex shrink-0 gap-1">
                  {s.keys.split(' ').map((key, i) =>
                    key === '/' || key === '+' || key === '→' ? (
                      <span key={i} className="text-[12px] text-zinc-400">{key}</span>
                    ) : (
                      <kbd key={i} className="rounded border border-zinc-300 bg-zinc-50 px-1.5 py-px text-[12px] font-semibold text-zinc-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                        {key}
                      </kbd>
                    ),
                  )}
                </span>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </>
  )
}
