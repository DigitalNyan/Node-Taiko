import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  root: 'frontend',
  plugins: [vue()],
  publicDir: '../public',
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:34801', changeOrigin: true },
      '/p2': { target: 'ws://127.0.0.1:34801', ws: true }
    }
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true
  }
})
