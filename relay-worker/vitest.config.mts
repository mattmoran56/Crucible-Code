import { defineConfig } from 'vitest/config'
import { cloudflareTest } from '@cloudflare/vitest-pool-workers'

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: './src/index.ts',
      miniflare: {
        // Stand-in for the KV binding so tests don't need a real namespace id.
        kvNamespaces: ['HANDLE_REGISTRY'],
      },
      wrangler: {
        configPath: './wrangler.toml',
      },
    }),
  ],
})
