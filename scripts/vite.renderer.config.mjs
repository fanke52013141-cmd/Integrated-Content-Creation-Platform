// 浏览器预览专用 vite 配置：只起渲染进程 dev server，不启动 Electron。
// 用途：配合 ?ui-fixtures=1 做 UI 预览与截图审查（npm run dev 会因 Electron
// 窗口被关闭而整个退出，浏览器预览需要独立长驻）。
// 运行：node node_modules/vite/bin/vite.js --config scripts/vite.renderer.config.mjs
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: resolve('src/renderer'),
  plugins: [react()],
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src'),
      '@shared': resolve('src/shared')
    }
  }
})
