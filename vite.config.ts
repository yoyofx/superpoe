import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import packageJson from './package.json'

export default defineConfig({
  base: process.env.ELECTRON_BUILD === 'true' ? './' : '/',
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(packageJson.version),
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 3000,
    open: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})
