import path from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') }
  },
  server: {
    // 5174 is reserved for the desktop app's dev renderer; admin UI runs on 5175.
    port: 5175,
    proxy: {
      // Dev convenience: proxy API calls to the backend to avoid CORS.
      '/api': { target: 'http://127.0.0.1:8080', changeOrigin: true, rewrite: p => p.replace(/^\/api/, '') }
    }
  }
})
