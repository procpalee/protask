import { useAuth } from '../store/authStore'

export default function Login() {
  const signIn = useAuth(s => s.signInGoogle)
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-6 px-6">
      <img src="/icons/icon-192.png" alt="Protask" className="h-16 w-16 rounded-2xl shadow-sm" />
      <div className="text-center">
        <h1 className="text-[21px] font-bold tracking-tight">Protask</h1>
        <p className="mt-1 text-[14px] text-zinc-500 dark:text-zinc-400">개인과 업무, 태스크와 프로젝트를 한 곳에서</p>
      </div>
      <button
        onClick={() => void signIn()}
        className="flex items-center gap-2.5 rounded-lg border border-zinc-300 bg-white px-5 py-2.5 text-[15px] font-medium shadow-sm transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
      >
        <GoogleIcon />
        Google로 로그인
      </button>
      <p className="text-[12.5px] text-zinc-400">허용된 계정만 접근할 수 있습니다</p>
    </div>
  )
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"/>
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"/>
      <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z"/>
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"/>
    </svg>
  )
}
