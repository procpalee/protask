import { useEffect, useState } from 'react'
import { Trash2, X, Repeat, Star } from 'lucide-react'
import { useStore, bucketOf, bucketPatch } from '../store/store'
import { BUCKET_LABEL, BUCKET_ORDER, type Bucket, type Recurrence } from '../types'
import { todayStr, toStr } from '../lib/dates'
import { addDays } from 'date-fns'
import Checklist from './Checklist'

/** 태스크 상세 — 중앙 팝업(다른 태스크 클릭 시 교체) */
export default function TaskDetail({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const task = useStore(s => s.tasks.find(t => t.id === taskId))
  const projects = useStore(s => s.projects)
  const workspaces = useStore(s => s.workspaces)
  const sections = useStore(s => s.sections)
  const updateTask = useStore(s => s.updateTask)
  const deleteTask = useStore(s => s.deleteTask)

  // App에서 key={taskId}로 마운트되므로 prop에서 곧바로 초기화(태스크 전환 시 자동 리셋)
  const [title, setTitle] = useState(task?.title ?? '')
  const [notes, setNotes] = useState(task?.notes ?? '')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!task) return null

  const saveTitle = () => {
    const v = title.trim()
    if (v && v !== task.title) updateTask(task.id, { title: v })
  }
  const saveNotes = () => {
    if (notes !== task.notes) updateTask(task.id, { notes })
  }

  const recValue = task.recurrence ? `${task.recurrence.freq}:${task.recurrence.interval}` : ''
  const setRec = (v: string) => {
    if (!v) return updateTask(task.id, { recurrence: null })
    const [freq, interval] = v.split(':')
    updateTask(task.id, { recurrence: { freq: freq as Recurrence['freq'], interval: Number(interval) } })
  }

  const sortedSections = [...sections].sort((a, b) => a.position - b.position)

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 pt-[9vh] backdrop-blur-[1px]"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="animate-[panel-in_140ms_ease-out] flex max-h-[82vh] w-full max-w-[600px] flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
        <div className="flex shrink-0 items-center gap-2 border-b border-zinc-100 bg-white px-4 py-2.5 dark:border-zinc-800 dark:bg-zinc-900">
          <span className="text-[13px] font-semibold text-zinc-400">태스크</span>
          <div className="ml-auto flex items-center gap-1">
            <button
              className={`rounded p-1.5 ${task.important ? 'text-amber-500' : 'text-zinc-400 hover:bg-zinc-100 hover:text-amber-500 dark:hover:bg-zinc-800'}`}
              title={task.important ? '중요 해제' : '중요 표시'}
              onClick={() => updateTask(task.id, { important: !task.important })}
            >
              <Star size={15} className={task.important ? 'fill-current' : ''} />
            </button>
            <button
              className="rounded p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950"
              title="삭제"
              onClick={() => {
                if (window.confirm(`"${task.title}" 태스크를 삭제할까요?`)) {
                  deleteTask(task.id)
                  onClose()
                }
              }}
            >
              <Trash2 size={15} />
            </button>
            <button className="rounded p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800" onClick={onClose} title="닫기 (Esc)">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <input
            className="w-full bg-transparent text-[17px] font-semibold outline-none placeholder:text-zinc-400"
            value={title}
            onChange={e => setTitle(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            placeholder="태스크 이름"
          />

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <label className="block">
              <span className="mb-1 block text-[12.5px] font-semibold text-zinc-400">프로젝트</span>
              <select
                className="input"
                value={task.project_id ?? ''}
                onChange={e => {
                  const pid = e.target.value || null
                  const proj = pid ? projects.find(p => p.id === pid) : null
                  updateTask(task.id, { project_id: pid, workspace_id: proj?.workspace_id ?? null })
                }}
              >
                <option value="">없음 (Inbox)</option>
                {workspaces.map(w => (
                  <optgroup key={w.id} label={w.name}>
                    {projects.filter(p => p.workspace_id === w.id).map(p => (
                      <option key={p.id} value={p.id}>{p.title}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-[12.5px] font-semibold text-zinc-400">구분</span>
              <select
                className="input"
                value={bucketOf(task)}
                onChange={e => updateTask(task.id, bucketPatch(e.target.value as Bucket))}
              >
                {BUCKET_ORDER.map(c => <option key={c} value={c}>{BUCKET_LABEL[c]}</option>)}
              </select>
              <span className="mt-1 block px-0.5 text-[12px] text-zinc-400">오늘 = 실행일 오늘·연체 · 예정 = 실행일 미래 · 언젠가 = Someday</span>
            </label>

            <label className="block">
              <span className="mb-1 flex items-center gap-1 text-[12.5px] font-semibold text-zinc-400"><Repeat size={11} /> 반복</span>
              <select className="input" value={recValue} onChange={e => setRec(e.target.value)}>
                <option value="">없음</option>
                <option value="daily:1">매일</option>
                <option value="weekly:1">매주</option>
                <option value="weekly:2">격주</option>
                <option value="monthly:1">매월</option>
                <option value="monthly:3">분기</option>
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-[12.5px] font-semibold text-zinc-400">실행일 (Schedule)</span>
              <input
                type="date"
                className="input"
                value={task.scheduled_date ?? ''}
                onChange={e => updateTask(task.id, { scheduled_date: e.target.value || null })}
              />
              <div className="mt-1 flex flex-wrap gap-1">
                <button className="btn btn-ghost !px-1.5 !py-0.5 !text-[12px]" onClick={() => updateTask(task.id, { scheduled_date: todayStr() })}>오늘</button>
                <button className="btn btn-ghost !px-1.5 !py-0.5 !text-[12px]" onClick={() => updateTask(task.id, { scheduled_date: toStr(addDays(new Date(), 1)) })}>내일</button>
                <button className="btn btn-ghost !px-1.5 !py-0.5 !text-[12px]" onClick={() => updateTask(task.id, { scheduled_date: toStr(addDays(new Date(), 7)) })}>+1주</button>
                {task.scheduled_date && (
                  <button className="btn btn-ghost !px-1.5 !py-0.5 !text-[12px] text-red-500" onClick={() => updateTask(task.id, { scheduled_date: null })}>지움</button>
                )}
              </div>
            </label>

            <label className="block">
              <span className="mb-1 block text-[12.5px] font-semibold text-zinc-400">마감일 (Deadline)</span>
              <input
                type="date"
                className="input"
                value={task.deadline ?? ''}
                onChange={e => updateTask(task.id, { deadline: e.target.value || null })}
              />
            </label>

            {task.scheduled_date && (
              <label className="block">
                <span className="mb-1 block text-[12.5px] font-semibold text-zinc-400">시간대 섹션</span>
                <select
                  className="input"
                  value={task.today_section ?? ''}
                  onChange={e => updateTask(task.id, { today_section: e.target.value || null })}
                >
                  <option value="">미지정</option>
                  {sortedSections.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
            )}
          </div>

          <div>
            <span className="mb-1 block text-[12.5px] font-semibold text-zinc-400">서브태스크</span>
            <Checklist items={task.checklist} onChange={next => updateTask(task.id, { checklist: next })} />
          </div>

          <label className="block">
            <span className="mb-1 block text-[12.5px] font-semibold text-zinc-400">메모</span>
            <textarea
              className="input min-h-[80px] resize-y"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              onBlur={saveNotes}
              placeholder="메모…"
            />
          </label>
        </div>
      </div>
    </div>
  )
}
