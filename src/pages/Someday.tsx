import { useMemo, useState } from 'react'
import { Moon, Folder } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useStore, selSomeday, useNavOrder, projectColor } from '../store/store'
import type { Task } from '../types'
import TaskRow from '../components/TaskRow'

/** Someday(언젠가) — Inbox와 동일 구성. 날짜 배정 시 Someday에서 빠져나감(칸반 백로그와 동일 집합) */
export default function SomedayPage() {
  const someday = useStore(useShallow(selSomeday))
  const workspaces = useStore(s => s.workspaces)
  const projects = useStore(s => s.projects)
  const addTask = useStore(s => s.addTask)
  const openDetail = useStore(s => s.openDetail)
  const [text, setText] = useState('')

  const submit = () => {
    const v = text.trim()
    if (!v) return
    addTask({ title: v, someday: true })
    setText('')
  }

  // 워크스페이스 ▸ 프로젝트 2단 그룹. 워크스페이스 없는 항목은 맨 위.
  const { noWs, groups } = useMemo(() => {
    const noWs = someday.filter(t => !t.workspace_id)
    const byWs = new Map<string, Task[]>()
    for (const t of someday) {
      if (!t.workspace_id) continue
      if (!byWs.has(t.workspace_id)) byWs.set(t.workspace_id, [])
      byWs.get(t.workspace_id)!.push(t)
    }
    const groups = workspaces.filter(w => byWs.has(w.id)).map(w => {
      const wsTasks = byWs.get(w.id)!
      const wsProjects = projects.filter(p => p.workspace_id === w.id).sort((a, b) => a.position - b.position)
      const subs = wsProjects
        .map(p => ({ project: p, tasks: wsTasks.filter(t => t.project_id === p.id) }))
        .filter(s => s.tasks.length)
      const noProj = wsTasks.filter(t => !t.project_id || !wsProjects.some(p => p.id === t.project_id))
      return { ws: w, subs, noProj, total: wsTasks.length }
    })
    return { noWs, groups }
  }, [someday, workspaces, projects])

  useNavOrder(useMemo(
    () => [...noWs, ...groups.flatMap(g => [...g.subs.flatMap(s => s.tasks), ...g.noProj])].map(t => t.id),
    [noWs, groups],
  ))

  return (
    <div className="mx-auto max-w-[760px] px-5 py-5">
      <div className="mb-4 flex items-baseline gap-2">
        <Moon size={16} className="self-center text-violet-400" />
        <h1 className="text-[19px] font-bold tracking-tight">Someday</h1>
        <span className="text-[13.5px] font-medium text-zinc-400">{someday.length}건</span>
      </div>

      {/* 빠른 입력 — 모바일에선 + 버튼(전역 캡처)으로 대체되므로 숨김 */}
      <div className="mb-4 hidden items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-1 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20 md:flex dark:border-zinc-700 dark:bg-zinc-900">
        <Moon size={15} className="shrink-0 text-zinc-400" />
        <input
          data-capture
          className="h-9 flex-1 bg-transparent text-[14.5px] outline-none placeholder:text-zinc-400"
          placeholder="언젠가 할 일을 입력 — Enter"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && submit()}
        />
      </div>

      {noWs.length > 0 && (
        <section className="mb-4">
          {groups.length > 0 && <GroupHead label="미분류" count={noWs.length} />}
          {noWs.map(t => <TaskRow key={t.id} task={t} onOpen={openDetail} />)}
        </section>
      )}

      {groups.map(({ ws, subs, noProj, total }) => (
        <section key={ws.id} className="mb-4">
          <GroupHead label={ws.name} count={total} />
          {subs.map(s => (
            <div key={s.project.id} className="mb-1.5">
              <SubHead label={s.project.title} count={s.tasks.length} color={projectColor(s.project.id, projects)} />
              {s.tasks.map(t => <TaskRow key={t.id} task={t} onOpen={openDetail} />)}
            </div>
          ))}
          {noProj.length > 0 && (
            <div className="mb-1.5">
              {subs.length > 0 && <SubHead label="프로젝트 없음" count={noProj.length} muted />}
              {noProj.map(t => <TaskRow key={t.id} task={t} onOpen={openDetail} />)}
            </div>
          )}
        </section>
      ))}

      {someday.length === 0 && (
        <div className="rounded-lg border border-dashed border-zinc-300 p-10 text-center text-[14px] text-zinc-400 dark:border-zinc-700">
          보류 중인 태스크가 없습니다
        </div>
      )}
    </div>
  )
}

function GroupHead({ label, count }: { label: string; count: number }) {
  return (
    <div className="mb-0.5 flex items-baseline gap-1.5 px-1.5">
      <Folder size={12} className="shrink-0 self-center text-zinc-400" />
      <span className="text-[13px] font-bold">{label}</span>
      <span className="text-[12px] font-semibold text-zinc-400">{count}</span>
    </div>
  )
}

/** 워크스페이스 아래 프로젝트 소제목 (들여쓰기, 프로젝트 색 점) */
function SubHead({ label, count, muted, color }: { label: string; count: number; muted?: boolean; color?: string }) {
  return (
    <div className="mt-0.5 mb-0.5 flex items-baseline gap-1.5 pl-4">
      {color && <span className="h-2 w-2 shrink-0 self-center rounded-[3px]" style={{ background: color }} />}
      <span className={`text-[12.5px] font-semibold ${muted ? 'text-zinc-400' : 'text-zinc-500 dark:text-zinc-300'}`}>{label}</span>
      <span className="text-[11.5px] font-semibold text-zinc-400">{count}</span>
    </div>
  )
}
