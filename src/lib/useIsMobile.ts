import { useSyncExternalStore } from 'react'

// md 미만(<768px)을 모바일로 간주 — Tailwind md 브레이크포인트와 일치
const QUERY = '(max-width: 767px)'

function subscribe(cb: () => void) {
  const m = window.matchMedia(QUERY)
  m.addEventListener('change', cb)
  return () => m.removeEventListener('change', cb)
}

/** 뷰포트가 모바일 폭인지 반응형으로 구독 — 뷰 모드 강제 등 JS 분기에 사용 */
export function useIsMobile() {
  return useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches, () => false)
}
