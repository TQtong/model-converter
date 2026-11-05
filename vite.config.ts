import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  plugins: [react()],
  worker: { format: 'es' },
  // 冷启动时预先登记 Worker 的 CommonJS 入口，避免首次格式测试触发依赖重扫和页面重载。
  optimizeDeps: {
    include: [
      'react',
      'react-dom/client',
      'three',
      'fflate',
      'occt-import-js',
      'web-ifc',
      'assimpjs-fbx',
      '@loaders.gl/core',
      '@loaders.gl/las',
      '@sparkjsdev/spark',
    ],
  },
})
