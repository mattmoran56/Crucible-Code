export type ThemeName = 'dark' | 'dark-contrast' | 'light' | 'soft-light' | 'ultra-dark'
export type ClaudeTheme = 'dark' | 'light'

export interface TerminalTheme {
  background: string
  foreground: string
  cursor: string
  selectionBackground: string
  black: string
  red: string
  green: string
  yellow: string
  blue: string
  magenta: string
  cyan: string
  white: string
}

export interface ThemeDefinition {
  name: ThemeName
  label: string
  isDark: boolean
  claudeTheme: ClaudeTheme
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
  terminal: TerminalTheme
}

export const THEMES: ThemeDefinition[] = [
  {
    name: 'dark',
    label: 'Tokyo Night',
    isDark: true,
    claudeTheme: 'dark',
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
    terminal: {
      background: '#1a1b26',
      foreground: '#c0caf5',
      cursor: '#c0caf5',
      selectionBackground: '#33467c',
      black: '#15161e',
      red: '#f7768e',
      green: '#9ece6a',
      yellow: '#e0af68',
      blue: '#7aa2f7',
      magenta: '#bb9af7',
      cyan: '#7dcfff',
      white: '#a9b1d6',
    },
  },
  {
    name: 'dark-contrast',
    label: 'Tokyo Night Contrast',
    isDark: true,
    claudeTheme: 'dark',
    colors: {
      bg: '#16161e',
      'bg-secondary': '#22253a',
      'bg-tertiary': '#1c1e2c',
      border: '#4a5280',
      text: '#d5dcfb',
      'text-muted': '#7580b0',
      accent: '#89b4fa',
      'accent-hover': '#a3c4fc',
      success: '#a9dc76',
      danger: '#ff8aa0',
      warning: '#eebd78',
    },
    terminal: {
      background: '#16161e',
      foreground: '#d5dcfb',
      cursor: '#d5dcfb',
      selectionBackground: '#3a4f8c',
      black: '#16161e',
      red: '#ff8aa0',
      green: '#a9dc76',
      yellow: '#eebd78',
      blue: '#89b4fa',
      magenta: '#c7a9ff',
      cyan: '#8ad8ff',
      white: '#bcc4e6',
    },
  },
  {
    name: 'light',
    label: 'Light',
    isDark: false,
    claudeTheme: 'light',
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
    terminal: {
      background: '#f5f5f5',
      foreground: '#1a1a2e',
      cursor: '#3b82f6',
      selectionBackground: '#3b82f630',
      black: '#1a1a2e',
      red: '#dc2626',
      green: '#16a34a',
      yellow: '#ca8a04',
      blue: '#2563eb',
      magenta: '#7c3aed',
      cyan: '#0891b2',
      white: '#6b7280',
    },
  },
  {
    name: 'soft-light',
    label: 'Soft Light',
    isDark: false,
    claudeTheme: 'light',
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
    terminal: {
      background: '#faf6f1',
      foreground: '#3d3229',
      cursor: '#7c6f9b',
      selectionBackground: '#7c6f9b30',
      black: '#3d3229',
      red: '#c46a6a',
      green: '#6a9e6b',
      yellow: '#c4976a',
      blue: '#6b7ba0',
      magenta: '#9b7094',
      cyan: '#4e9b8e',
      white: '#8c7e72',
    },
  },
  {
    name: 'ultra-dark',
    label: 'Ultra Dark',
    isDark: true,
    claudeTheme: 'dark',
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
    terminal: {
      background: '#0d0d0d',
      foreground: '#d4d4d4',
      cursor: '#6d9efd',
      selectionBackground: '#3d3d3d',
      black: '#0d0d0d',
      red: '#fb7185',
      green: '#4ade80',
      yellow: '#fbbf24',
      blue: '#6d9efd',
      magenta: '#c084fc',
      cyan: '#67e8f9',
      white: '#d4d4d4',
    },
  },
]
