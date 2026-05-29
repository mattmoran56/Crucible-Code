import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@protocol': path.resolve(__dirname, '../protocol'),
      '@renderer': path.resolve(__dirname, '../../src/renderer'),
      '@shared': path.resolve(__dirname, '../../src/shared'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
