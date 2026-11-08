import type { Preview } from '@storybook/react'
import { withThemeByDataAttribute } from '@storybook/addon-themes'

// Mock window.api BEFORE any store or component imports
import { mockApi } from '@mock/mockApi'
;(window as any).api = mockApi

// Import styles
import '@xterm/xterm/css/xterm.css'
import '../src/renderer/styles/globals.css'

// Expose setTheme on window so the screenshot script can sync terminal theme
import { useSettingsStore } from '../src/renderer/stores/settingsStore'
;(window as any).__setTheme = (theme: string) => {
  useSettingsStore.getState().setTheme(theme as any)
}

const preview: Preview = {
  decorators: [
    withThemeByDataAttribute({
      themes: {
        'Dark (Tokyo Night)': 'dark',
        Light: 'light',
        'Soft Light': 'soft-light',
        'Ultra Dark': 'ultra-dark',
        'Tokyo Night High Contrast': 'dark-hc',
        'Light High Contrast': 'light-hc',
        'Soft Light High Contrast': 'soft-light-hc',
        'Ultra Dark High Contrast': 'ultra-dark-hc',
      },
      defaultTheme: 'Dark (Tokyo Night)',
      attributeName: 'data-theme',
    }),
  ],
  parameters: {
    layout: 'fullscreen',
    backgrounds: { disable: true },
  },
}

export default preview
