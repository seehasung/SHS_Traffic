import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// 개발 중에는 5173 포트로 띄우고, /api 와 /ws 호출은 17321(에이전트)로 프록시한다.
// 운영 시에는 에이전트가 빌드된 파일을 그대로 서빙하므로 동일 출처가 된다.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: path.resolve(here, '../web-dist'),
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(here, 'src'),
      '@shared': path.resolve(here, '../shared'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:17321',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://127.0.0.1:17321',
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
