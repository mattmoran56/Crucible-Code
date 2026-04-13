import type { StorybookConfig } from '@storybook/react-vite'
import path from 'path'

const config: StorybookConfig = {
  stories: [
    '../src/renderer/**/*.stories.@(ts|tsx)',
  ],
  addons: [
    '@storybook/addon-essentials',
    '@storybook/addon-themes',
  ],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  viteFinal: async (config) => {
    const tailwindcss = (await import('@tailwindcss/vite')).default
    config.plugins = config.plugins || []
    config.plugins.push(tailwindcss())

    // Allow serving files from the mock/ directory and project root
    config.server = config.server || {}
    config.server.fs = config.server.fs || {}
    config.server.fs.allow = [
      ...(config.server.fs.allow || []),
      path.resolve(__dirname, '..'),
    ]

    // Alias mock/ so imports resolve correctly
    config.resolve = config.resolve || {}
    config.resolve.alias = {
      ...config.resolve.alias,
      '@mock': path.resolve(__dirname, '../mock'),
    }

    return config
  },
}

export default config
