import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  base: process.env.ELECTRON_BUILD === 'true' ? './' : '/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(projectRoot, 'src'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 3000,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})
