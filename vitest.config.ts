import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@renderer': path.resolve(__dirname, 'src/renderer'),
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/unit/setup.ts'],
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    css: false,
    // jsdom + React leak DOM nodes across files in a long-lived worker, so we
    // run each file in a fresh sub-process. fileParallelism: false serialises
    // them to keep memory bounded in CI/sandbox environments.
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: false, maxForks: 1 },
    },
    isolate: true,
    fileParallelism: false,
    sequence: { concurrent: false },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      include: [
        'src/renderer/lib/**/*.ts',
        'src/renderer/hooks/**/*.ts',
        'src/renderer/stores/**/*.ts',
        'src/renderer/components/**/*.tsx',
        'src/shared/**/*.ts',
      ],
      exclude: [
        '**/*.stories.tsx',
        '**/*.test.{ts,tsx}',
        'src/shared/types.ts',
      ],
    },
  },
})
