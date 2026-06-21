import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png'],
      manifest: {
        name: 'Protask',
        short_name: 'Protask',
        description: '개인과 업무, 태스크와 프로젝트를 통합하는 워크스페이스·GTD 할일 관리',
        start_url: '.',
        display: 'standalone',
        background_color: '#fafafa',
        theme_color: '#6366f1',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        // 앱 아이콘 길게 누르기 메뉴 (Android Chrome)
        shortcuts: [
          { name: '빠른 캡처', short_name: '캡처', description: '바로 할 일 입력', url: '/?capture=1', icons: [{ src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' }] },
          { name: '오늘', short_name: '오늘', url: '/', icons: [{ src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' }] },
          { name: 'Inbox', short_name: 'Inbox', url: '/inbox', icons: [{ src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' }] },
        ],
        // 공유 시트 → Protask로 Inbox 캡처 (Android Chrome). GET이면 /?title=&text=로 앱이 열림
        share_target: {
          action: '/',
          method: 'GET',
          params: { title: 'title', text: 'text', url: 'url' },
        },
      },
      workbox: {
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallback: 'index.html',
      },
    }),
  ],
  define: {
    'process.env.IS_PREACT': JSON.stringify('false'),
  },
})
