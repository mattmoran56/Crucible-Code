export type ThemeName =
  | 'dark'
  | 'light'
  | 'soft-light'
  | 'ultra-dark'
  | 'dark-hc'
  | 'light-hc'
  | 'soft-light-hc'
  | 'ultra-dark-hc'
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

  /*
   * High-contrast variants.
   *
   * Each one keeps the hues of its base theme but is tuned to WCAG 2.2 AAA:
   * every colour that can carry text (text, text-muted, accent, accent-hover,
   * success, danger, warning and the terminal ANSI colours) reaches at least
   * 7:1 against bg, bg-secondary AND bg-tertiary, and borders reach the 3:1
   * non-text contrast ratio. Because contrast is symmetric, `text-bg` on a
   * filled accent/status background is also >= 7:1.
   * tests/unit/shared/themes.test.ts enforces these ratios.
   */
  {
    name: 'dark-hc',
    label: 'Tokyo Night High Contrast',
    isDark: true,
    claudeTheme: 'dark',
    colors: {
      bg: '#101119',
      'bg-secondary': '#1a1c2b',
      'bg-tertiary': '#15161f',
      border: '#5d6898',
      text: '#eef1ff',
      'text-muted': '#a5accf',
      accent: '#9ab8f9',
      'accent-hover': '#bed1fb',
      success: '#9ece6a',
      danger: '#f99fb0',
      warning: '#e0b06a',
    },
    terminal: {
      background: '#101119',
      foreground: '#eef1ff',
      cursor: '#eef1ff',
      selectionBackground: '#2d3c6b',
      black: '#1a1c2b',
      red: '#f99fb0',
      green: '#9ece6a',
      yellow: '#e0b06a',
      blue: '#9ab8f9',
      magenta: '#c6abf8',
      cyan: '#7dcfff',
      white: '#afb7d9',
    },
  },
  {
    name: 'light-hc',
    label: 'Light High Contrast',
    isDark: false,
    claudeTheme: 'light',
    colors: {
      bg: '#ffffff',
      'bg-secondary': '#f0f0f0',
      'bg-tertiary': '#f7f7f7',
      border: '#888888',
      text: '#0b0b14',
      'text-muted': '#4b505a',
      accent: '#0849b2',
      'accent-hover': '#063787',
      success: '#105c2c',
      danger: '#a20e0e',
      warning: '#6f4705',
    },
    terminal: {
      background: '#ffffff',
      foreground: '#0b0b14',
      cursor: '#0849b2',
      selectionBackground: '#c9dcff',
      black: '#0b0b14',
      red: '#9e1919',
      green: '#0c5c2a',
      yellow: '#6b4902',
      blue: '#1146ba',
      magenta: '#5e14dc',
      cyan: '#05576b',
      white: '#4b505a',
    },
  },
  {
    name: 'soft-light-hc',
    label: 'Soft Light High Contrast',
    isDark: false,
    claudeTheme: 'light',
    colors: {
      bg: '#fdfaf6',
      'bg-secondary': '#f3ede5',
      'bg-tertiary': '#f8f4ee',
      border: '#9b8363',
      text: '#1c140d',
      'text-muted': '#564d46',
      accent: '#53496a',
      'accent-hover': '#403851',
      success: '#385639',
      danger: '#853535',
      warning: '#684829',
    },
    terminal: {
      background: '#fdfaf6',
      foreground: '#1c140d',
      cursor: '#53496a',
      selectionBackground: '#e0d6ef',
      black: '#1c140d',
      red: '#853535',
      green: '#385639',
      yellow: '#684829',
      blue: '#434f69',
      magenta: '#63455e',
      cyan: '#2c564f',
      white: '#564d46',
    },
  },
  {
    name: 'ultra-dark-hc',
    label: 'Ultra Dark High Contrast',
    isDark: true,
    claudeTheme: 'dark',
    colors: {
      bg: '#000000',
      'bg-secondary': '#0f0f0f',
      'bg-tertiary': '#080808',
      border: '#626262',
      text: '#f5f5f5',
      'text-muted': '#a2a2a2',
      accent: '#83adfd',
      'accent-hover': '#a5c4fe',
      success: '#4ade80',
      danger: '#fc8c9c',
      warning: '#fbbf24',
    },
    terminal: {
      background: '#000000',
      foreground: '#f5f5f5',
      cursor: '#83adfd',
      selectionBackground: '#24365c',
      black: '#000000',
      red: '#fc8c9c',
      green: '#4ade80',
      yellow: '#fbbf24',
      blue: '#83adfd',
      magenta: '#ca97fc',
      cyan: '#67e8f9',
      white: '#d4d4d4',
    },
  },
]
