// vite.config.js
import { defineConfig } from 'vite'
import path from 'path'

const backendUrl = process.env.BACKEND_URL || 'http://localhost:5000';

export default defineConfig({
  server: {
    allowedHosts: ['eden.donmacaron.net'],
    host: true, // allow access from outside container
    port: 5173,
    proxy: {
      '/api': {
        target: backendUrl,
        changeOrigin: true,
        secure: false
      }
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
})
