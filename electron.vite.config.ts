import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { execSync } from 'child_process'

const builtCommit = execSync('git rev-parse HEAD').toString().trim()

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    define: {
      __REPO_PATH__: JSON.stringify(process.cwd()),
      __BUILT_COMMIT__: JSON.stringify(builtCommit),
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    plugins: [react(), tailwindcss()]
  }
})
