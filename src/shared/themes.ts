export type ThemeName = 'dark' | 'light' | 'soft-light' | 'ultra-dark'

export interface ThemeDefinition {
  name: ThemeName
  label: string
  colors: {
    bg: string
    'bg-secondary': string
    'bg-tertiary': string
    border: string
    text: string
    'text-muted': string
    accent: string
    'accent-hover': string
    success: string
    danger: string
    warning: string
  }
}

export const THEMES: ThemeDefinition[] = [
  {
    name: 'dark',
    label: 'Tokyo Night',
    colors: {
      bg: '#1a1b26',
      'bg-secondary': '#24283b',
      'bg-tertiary': '#1f2335',
      border: '#3b4261',
      text: '#c0caf5',
      'text-muted': '#565f89',
      accent: '#7aa2f7',
      'accent-hover': '#89b4fa',
      success: '#9ece6a',
      danger: '#f7768e',
      warning: '#e0af68',
    },
  },
  {
    name: 'light',
    label: 'Light',
    colors: {
      bg: '#f5f5f5',
      'bg-secondary': '#e8e8e8',
      'bg-tertiary': '#efefef',
      border: '#d0d0d0',
      text: '#1a1a2e',
      'text-muted': '#6b7280',
      accent: '#3b82f6',
      'accent-hover': '#2563eb',
      success: '#22c55e',
      danger: '#ef4444',
      warning: '#f59e0b',
    },
  },
  {
    name: 'soft-light',
    label: 'Soft Light',
    colors: {
      bg: '#faf6f1',
      'bg-secondary': '#f0ebe4',
      'bg-tertiary': '#f5f0ea',
      border: '#ddd5ca',
      text: '#3d3229',
      'text-muted': '#8c7e72',
      accent: '#7c6f9b',
      'accent-hover': '#6b5e8a',
      success: '#6a9e6b',
      danger: '#c46a6a',
      warning: '#c4976a',
    },
  },
  {
    name: 'ultra-dark',
    label: 'Ultra Dark',
    colors: {
      bg: '#0d0d0d',
      'bg-secondary': '#141414',
      'bg-tertiary': '#111111',
      border: '#252525',
      text: '#d4d4d4',
      'text-muted': '#525252',
      accent: '#6d9efd',
      'accent-hover': '#85b0ff',
      success: '#4ade80',
      danger: '#fb7185',
      warning: '#fbbf24',
    },
  },
]
