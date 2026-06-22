import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Download, CalendarCheck2, Unplug, LogOut, RefreshCw, FolderGit2, FolderPlus, RotateCw, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { gcalEnabled } from '../lib/gcal'
import { useGcal } from '../store/gcalStore'
import { useAuth, REQUIRE_AUTH } from '../store/authStore'
import { connectFolder, listFolders, removeFolder, syncFolder, fsSupported, type FolderMeta } from '../lib/folderConnect'
import { promptDialog, confirmDialog } from '../store/dialogStore'

export default function SettingsPage() {
  const [exporting, setExporting] = useState(false)
  const gcal = useGcal()
  const session = useAuth(s => s.session)
  const signOut = useAuth(s => s.signOut)

  // 로컬 폴더 연결
  const [folders, setFolders] = useState<FolderMeta[]>([])
  const [busy, setBusy] = useState<string | null>(null) // 동기화 중인 폴더 id 또는 'connect'
  const [fsErr, setFsErr] = useState<string | null>(null)
  const refreshFolders = () => void listFolders().then(setFolders)

  useEffect(() => {
    void gcal.init()
    refreshFolders()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onConnect = async () => {
    setFsErr(null)
    setBusy('connect')
    try {
      const name = await promptDialog({ title: '폴더 연결', placeholder: '프로젝트 이름(비우면 폴더명)', confirmLabel: '폴더 선택…' })
      if (name === null) return // 취소
      const m = await connectFolder(name)
      if (m) refreshFolders()
    } catch (e) {
      setFsErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const onSync = async (m: FolderMeta) => {
    setFsErr(null)
    setBusy(m.id)
    try {
      await syncFolder(m)
      refreshFolders()
    } catch (e) {
      setFsErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const onDisconnect = async (m: FolderMeta) => {
    if (!(await confirmDialog({ title: '연결 해제', message: `"${m.name}" 폴더 연결을 끊을까요? 보드의 프로젝트·태스크는 남습니다(이후 자동 동기화만 중단).`, confirmLabel: '연결 해제' }))) return
    await removeFolder(m.id)
    refreshFolders()
  }

  const exportJson = async () => {
    setExporting(true)
    try {
      const [ws, ph, pr, tk, cv, sc] = await Promise.all([
        supabase.from('workspaces').select('*'),
        supabase.from('phases').select('*'),
        supabase.from('projects').select('*'),
        supabase.from('tasks').select('*'),
        supabase.from('workspace_canvas').select('*'),
        supabase.from('today_sections').select('*'),
      ])
      const blob = new Blob(
        [JSON.stringify({
          exported_at: new Date().toISOString(),
          workspaces: ws.data, phases: ph.data, projects: pr.data, tasks: tk.data, workspace_canvas: cv.data, today_sections: sc.data,
        }, null, 2)],
        { type: 'application/json' },
      )
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `dashboard-backup-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(a.href)
    } finally {
      setExporting(false)
    }
  }

  const isChecked = (id: string) => gcal.selected === null || gcal.selected.includes(id)
  const toggleCal = (id: string) => {
    const all = gcal.calendars.map(c => c.id)
    const cur = gcal.selected === null ? all : gcal.selected
    const next = cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id]
    gcal.setSelected(next.length === all.length ? null : next)
  }

  return (
    <div className="mx-auto max-w-[680px] px-5 py-5">
      <h1 className="mb-5 text-[19px] font-bold tracking-tight">설정</h1>

      <section className="mb-6 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-1 flex items-center gap-1.5 text-[14.5px] font-bold"><Download size={14} /> 백업</h2>
        <p className="mb-3 text-[13.5px] text-zinc-400">전체 데이터(프로젝트·서브프로젝트·태스크·캔버스·섹션)를 JSON 파일로 내보냅니다. 주기적으로 받아두세요.</p>
        <button className="btn btn-primary" onClick={() => void exportJson()} disabled={exporting}>
          {exporting ? '내보내는 중…' : 'JSON 내보내기'}
        </button>
      </section>

      <section className="mb-6 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-1 flex items-center gap-1.5 text-[14.5px] font-bold"><FolderGit2 size={14} /> 로컬 폴더 연결</h2>
        <p className="mb-3 text-[13.5px] text-zinc-400">
          로컬 프로젝트 폴더를 선택하면 그 안의 체크리스트(<code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">TODO.md</code>의 <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">- [ ]</code>)가 프로젝트·태스크로 들어오고, <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">README.md</code>는 개요로 표시됩니다. 폴더가 바뀌면 “동기화”를 누르세요.
        </p>
        {!fsSupported ? (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-[13px] text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
            이 브라우저는 폴더 선택(File System Access)을 지원하지 않습니다. 데스크탑 <b>Chrome·Edge</b>에서 열어 주세요.
          </p>
        ) : (
          <>
            <button className="btn btn-primary" onClick={() => void onConnect()} disabled={busy !== null}>
              <FolderPlus size={14} /> {busy === 'connect' ? '연결 중…' : '폴더 연결'}
            </button>
            {fsErr && <p className="mt-2 text-[12.5px] text-red-600 dark:text-red-400">{fsErr}</p>}
            {folders.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {folders.map(m => (
                  <li key={m.id} className="flex items-center gap-2 rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-800">
                    <FolderGit2 size={14} className="shrink-0 text-zinc-400" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13.5px] font-semibold">{m.name}</div>
                      <div className="text-[12px] text-zinc-400">
                        {m.handle.name} · {m.lastSync ? `마지막 동기화 ${new Date(m.lastSync).toLocaleString()}` : '미동기화'}
                      </div>
                    </div>
                    <button className="btn !py-1" onClick={() => void onSync(m)} disabled={busy !== null} title="다시 동기화">
                      <RotateCw size={13} className={busy === m.id ? 'animate-spin' : ''} /> 동기화
                    </button>
                    <button className="btn btn-danger !py-1" onClick={() => void onDisconnect(m)} disabled={busy !== null} title="연결 해제">
                      <Trash2 size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-1 flex items-center gap-1.5 text-[14.5px] font-bold"><CalendarCheck2 size={14} /> 구글캘린더</h2>
        {!gcalEnabled ? (
          <p className="text-[13.5px] text-zinc-400">
            연동하려면 <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">VITE_GOOGLE_CLIENT_ID</code> 환경변수가 필요합니다. 자세한 절차는{' '}
            <Link to="/guide" className="text-blue-600 underline dark:text-blue-400">사용 설명서</Link>를 참고하세요.
          </p>
        ) : gcal.status === 'connected' ? (
          <div>
            <div className="mb-1 flex items-center gap-2">
              <p className="text-[13.5px] font-medium text-emerald-600 dark:text-emerald-400">연결됨</p>
              <button className="btn" onClick={() => void gcal.connect()} title="쓰기 권한 재동의 — 일정 추가·수정·삭제가 안 되면 눌러주세요">
                <RefreshCw size={13} /> 재연결(쓰기 권한)
              </button>
              <button className="btn" onClick={() => gcal.disconnect()}>
                <Unplug size={13} /> 연결 해제
              </button>
            </div>
            <p className="mb-3 text-[12.5px] text-zinc-400">일정 추가·수정·삭제가 안 되면 “재연결(쓰기 권한)”으로 한 번 재동의하세요.</p>
            <h3 className="mb-1.5 text-[13px] font-bold text-zinc-500 dark:text-zinc-400">표시할 캘린더</h3>
            <div className="space-y-1">
              {gcal.calendars.map(c => (
                <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 hover:bg-zinc-50 dark:hover:bg-zinc-800/60">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 accent-blue-600"
                    checked={isChecked(c.id)}
                    onChange={() => toggleCal(c.id)}
                  />
                  <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: c.color ?? '#3b82f6' }} />
                  <span className="text-[13.5px]">{c.summary}</span>
                  {c.primary && <span className="text-[11.5px] font-semibold text-zinc-400">기본</span>}
                </label>
              ))}
            </div>
          </div>
        ) : (
          <button className="btn btn-primary" onClick={() => void gcal.connect()}>연결</button>
        )}
      </section>

      {REQUIRE_AUTH && session && (
        <section className="mt-6 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-1 flex items-center gap-1.5 text-[14.5px] font-bold"><LogOut size={14} /> 계정</h2>
          <p className="mb-3 text-[13.5px] text-zinc-400">{session.user.email ?? '로그인됨'}</p>
          <button className="btn" onClick={() => void signOut()}>
            <LogOut size={13} /> 로그아웃
          </button>
        </section>
      )}

      <p className="mt-6 text-center text-[13.5px] text-zinc-400">
        사용법·단축키·GTD 개념은 <Link to="/guide" className="text-blue-600 underline dark:text-blue-400">사용 설명서</Link>에서 확인하세요.
      </p>
    </div>
  )
}
