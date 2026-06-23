import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Eye, Pencil } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { supabase } from '../lib/supabase'
import { enqueue } from '../lib/sync'
import { useStore } from '../store/store'

/** 프로젝트 개요 — 마크다운 메모(편집/미리보기). 2초 디바운스 자동저장(workspace_canvas.notes). */
export default function OverviewPage() {
  const { wsId } = useParams<{ wsId: string }>()
  const ws = useStore(s => s.workspaces.find(w => w.id === wsId))
  const [notes, setNotes] = useState('')
  const [editing, setEditing] = useState(false)
  const notesRef = useRef('')
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let cancelled = false
    notesRef.current = ''
    setNotes('')
    void (async () => {
      const { data } = await supabase.from('workspace_canvas').select('notes').eq('workspace_id', wsId).maybeSingle()
      if (cancelled) return
      setNotes(data?.notes ?? '')
      notesRef.current = data?.notes ?? ''
    })()
    return () => { cancelled = true }
  }, [wsId])

  const persist = useCallback(() => {
    if (!wsId) return
    // 삭제됐거나 존재하지 않는 워크스페이스엔 저장하지 않는다 — FK 위반(영구 실패 op) 방지.
    if (!useStore.getState().workspaces.some(w => w.id === wsId)) return
    // notes만 upsert → 기존 scene 컬럼(미사용)은 보존.
    enqueue({ table: 'workspace_canvas', kind: 'upsert', rowId: wsId, payload: { workspace_id: wsId, notes: notesRef.current } })
  }, [wsId])

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(persist, 2000)
  }, [persist])

  // 탭 이탈/언마운트 시 즉시 flush
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'hidden' && saveTimer.current) { clearTimeout(saveTimer.current); persist() }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      if (saveTimer.current) { clearTimeout(saveTimer.current); persist() }
    }
  }, [persist])

  if (!ws) return <div className="p-8 text-zinc-400">프로젝트를 찾을 수 없습니다.</div>

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-5 pt-4 pb-3">
        <Link to={`/w/${ws.id}`} className="btn btn-ghost !px-1.5" title="보드로"><ArrowLeft size={15} /></Link>
        <h1 className="text-[17px] font-bold tracking-tight">{ws.name} — 개요</h1>
        <span className="text-[12.5px] text-zinc-400">변경은 2초 후 자동 저장</span>
        <button className="btn btn-ghost ml-auto" onClick={() => setEditing(e => !e)} title={editing ? '미리보기' : '편집'}>
          {editing ? <><Eye size={14} /> 미리보기</> : <><Pencil size={14} /> 편집</>}
        </button>
      </div>

      <div className="min-h-0 flex-1 px-5 pb-5">
        <div className="mx-auto flex h-full max-w-3xl flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          {editing ? (
            <textarea
              autoFocus
              className="flex-1 resize-none bg-transparent px-6 py-5 text-[15px] leading-relaxed outline-none placeholder:text-zinc-400"
              placeholder="프로젝트 관련 내용을 자유롭게 작성…&#10;&#10;(마크다운으로 저장됩니다)"
              value={notes}
              onChange={e => { setNotes(e.target.value); notesRef.current = e.target.value; scheduleSave() }}
            />
          ) : (
            <div className="flex-1 overflow-y-auto px-6 py-5">
              {notes.trim() ? (
                <div className="md-preview lg"><ReactMarkdown remarkPlugins={[remarkGfm]}>{notes}</ReactMarkdown></div>
              ) : (
                <button className="text-[14px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300" onClick={() => setEditing(true)}>
                  아직 노트가 없습니다. 클릭해서 작성하세요.
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
