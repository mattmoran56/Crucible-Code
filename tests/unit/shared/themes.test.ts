import { describe, expect, it } from 'vitest'
import { THEMES, type ThemeName } from '../../../src/shared/themes'

const EXPECTED_NAMES: ThemeName[] = ['dark', 'light', 'soft-light', 'ultra-dark']

describe('THEMES', () => {
  it('includes every expected theme exactly once', () => {
    const names = THEMES.map((t) => t.name).sort()
    expect(names).toEqual([...EXPECTED_NAMES].sort())
  })

  it.each(EXPECTED_NAMES)('theme %s defines all required color tokens', (name) => {
    const theme = THEMES.find((t) => t.name === name)!
    expect(theme).toBeDefined()
    for (const key of [
      'bg', 'bg-secondary', 'bg-tertiary', 'border',
      'text', 'text-muted',
      'accent', 'accent-hover',
      'success', 'danger', 'warning',
    ] as const) {
      expect(theme.colors[key]).toMatch(/^#[0-9a-f]{3,8}$/i)
    }
  })

  it.each(EXPECTED_NAMES)('theme %s has a complete xterm palette', (name) => {
    const theme = THEMES.find((t) => t.name === name)!
    for (const key of [
      'background', 'foreground', 'cursor',
      'black', 'red', 'green', 'yellow',
      'blue', 'magenta', 'cyan', 'white',
    ] as const) {
      expect(theme.terminal[key]).toMatch(/^#[0-9a-f]{3,8}$/i)
    }
  })

  it('isDark matches claudeTheme', () => {
    for (const theme of THEMES) {
      expect(theme.claudeTheme).toBe(theme.isDark ? 'dark' : 'light')
    }
  })
})
