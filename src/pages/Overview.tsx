import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Eye, Maximize2, Minimize2, NotebookPen, PanelRightClose, PanelRightOpen, Pencil } from 'lucide-react'
import { Excalidraw } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { supabase } from '../lib/supabase'
import { enqueue } from '../lib/sync'
import { useStore } from '../store/store'

interface SceneData {
  elements?: readonly unknown[]
  appState?: Record<string, unknown>
  files?: Record<string, unknown>
}

export default function OverviewPage() {
  const { wsId } = useParams<{ wsId: string }>()
  const ws = useStore(s => s.workspaces.find(w => w.id === wsId))
  const [initial, setInitial] = useState<SceneData | null>(null)
  const [notes, setNotes] = useState('')
  const [notesOpen, setNotesOpen] = useState(true)
  const [editing, setEditing] = useState(false)
  const [notesFull, setNotesFull] = useState(false)
  // 데이터가 로드된 워크스페이스 id. 현재 wsId와 같을 때만 캔버스를 띄운다(전환 시 자동 언마운트)
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  const ready = loadedFor === wsId
  const dark = document.documentElement.classList.contains('dark')

  const sceneRef = useRef<SceneData>({})
  const notesRef = useRef('')
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const apiRef = useRef<{ scrollToContent: (t?: unknown, o?: unknown) => void; getSceneElements: () => unknown } | null>(null)

  // 처음 열릴 때 캔버스 내용을 화면 중앙에 맞춤
  useEffect(() => {
    if (!ready) return
    const id = setTimeout(() => {
      const api = apiRef.current
      if (api) api.scrollToContent(api.getSceneElements(), { fitToViewport: true, viewportZoomFactor: 0.8 })
    }, 200)
    return () => clearTimeout(id)
  }, [ready])

  useEffect(() => {
    let cancelled = false
    // 워크스페이스 전환 시 ref를 비워, 새 씬 로드 전 옛 씬이 다른 워크스페이스로 새어들어가는(오염) 것을 방지
    sceneRef.current = {}
    notesRef.current = ''
    void (async () => {
      const { data } = await supabase.from('workspace_canvas').select('*').eq('workspace_id', wsId).maybeSingle()
      if (cancelled) return
      const scene = (data?.scene ?? {}) as SceneData
      setInitial(scene)
      setNotes(data?.notes ?? '')
      notesRef.current = data?.notes ?? ''
      sceneRef.current = scene
      setLoadedFor(wsId ?? null) // 로드 완료 표시 → ready=true가 되어 새 씬으로 캔버스 마운트
    })()
    return () => {
      cancelled = true
    }
  }, [wsId])

  const persist = useCallback(() => {
    if (!wsId) return
    enqueue({
      table: 'workspace_canvas',
      kind: 'upsert',
      rowId: wsId,
      payload: { workspace_id: wsId, scene: sceneRef.current, notes: notesRef.current },
    })
  }, [wsId])

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(persist, 2000)
  }, [persist])

  // 탭 이탈 시 즉시 flush
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'hidden' && saveTimer.current) {
        clearTimeout(saveTimer.current)
        persist()
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      if (saveTimer.current) {
        clearTimeout(saveTimer.current)
        persist()
      }
    }
  }, [persist])

  if (!ws) return <div className="p-8 text-zinc-400">프로젝트를 찾을 수 없습니다.</div>

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-5 pt-4 pb-3">
        <Link to={`/w/${ws.id}`} className="btn btn-ghost !px-1.5" title="보드로">
          <ArrowLeft size={15} />
        </Link>
        <h1 className="text-[17px] font-bold tracking-tight">{ws.name} — 개요</h1>
        <span className="text-[12.5px] text-zinc-400">변경은 2초 후 자동 저장</span>
        {!notesFull && (
          <button className="btn btn-ghost ml-auto !px-1.5" onClick={() => setNotesOpen(o => !o)} title={notesOpen ? '노트 접기' : '노트 펼치기'}>
            {notesOpen ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
          </button>
        )}
      </div>

      <div className="flex min-h-0 flex-1 gap-3 px-5 pb-5">
        <div className={`min-w-0 flex-1 overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800 ${notesFull ? 'hidden' : ''}`}>
          {ready && (
            <Excalidraw
              key={wsId}
              theme={dark ? 'dark' : 'light'}
              excalidrawAPI={api => { apiRef.current = api as unknown as typeof apiRef.current }}
              initialData={{
                elements: (initial?.elements ?? []) as never,
                appState: { ...(initial?.appState ?? {}), collaborators: new Map() } as never,
                files: (initial?.files ?? {}) as never,
                scrollToContent: true,
              }}
              onChange={(elements, appState, files) => {
                const { collaborators: _c, ...cleanState } = appState as unknown as Record<string, unknown> & { collaborators?: unknown }
                sceneRef.current = {
                  elements: elements as readonly unknown[],
                  appState: {
                    viewBackgroundColor: cleanState.viewBackgroundColor,
                    currentItemFontFamily: cleanState.currentItemFontFamily,
                    gridSize: cleanState.gridSize,
                  },
                  files: files as Record<string, unknown>,
                }
                scheduleSave()
              }}
            />
          )}
        </div>

        {notesOpen && (
          <div className={`flex shrink-0 flex-col rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 ${notesFull ? 'flex-1' : 'w-[300px]'}`}>
            <div className="flex items-center gap-1.5 border-b border-zinc-100 px-3 py-2 dark:border-zinc-800">
              <NotebookPen size={13} className="text-zinc-400" />
              <span className="text-[13px] font-bold text-zinc-500 dark:text-zinc-400">프로젝트 노트</span>
              <button
                className="btn btn-ghost ml-auto !px-1.5 !py-1"
                onClick={() => setEditing(e => !e)}
                title={editing ? '미리보기' : '편집'}
              >
                {editing ? <Eye size={13} /> : <Pencil size={13} />}
              </button>
              <button
                className="btn btn-ghost !px-1.5 !py-1"
                onClick={() => setNotesFull(f => !f)}
                title={notesFull ? '사이드바로' : '전체화면'}
              >
                {notesFull ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
              </button>
            </div>
            {editing ? (
              <textarea
                autoFocus
                className={`flex-1 resize-none bg-transparent leading-relaxed outline-none placeholder:text-zinc-400 ${notesFull ? 'mx-auto w-full max-w-3xl px-6 py-6 text-[15.5px]' : 'p-3 text-[13.5px]'}`}
                placeholder="프로젝트 관련 내용을 자유롭게 작성…&#10;&#10;(마크다운 텍스트로 저장됩니다)"
                value={notes}
                onChange={e => {
                  setNotes(e.target.value)
                  notesRef.current = e.target.value
                  scheduleSave()
                }}
              />
            ) : (
              <div className={`flex-1 overflow-y-auto ${notesFull ? 'px-6 py-6' : 'p-3'}`}>
                {notes.trim() ? (
                  <div className={`md-preview ${notesFull ? 'lg mx-auto max-w-3xl' : ''}`}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{notes}</ReactMarkdown>
                  </div>
                ) : (
                  <p className="text-[13.5px] text-zinc-400">
                    아직 노트가 없습니다. 상단 편집 버튼으로 작성하세요.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
