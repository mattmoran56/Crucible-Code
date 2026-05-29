import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@protocol': path.resolve(__dirname, '../protocol'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
