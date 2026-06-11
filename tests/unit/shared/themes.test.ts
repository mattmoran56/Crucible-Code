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

const byName = (name: ThemeName) => THEMES.find((t) => t.name === name)!

function hexBrightness(hex: string): number {
  // Perceived brightness 0-255 from a #rrggbb value.
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return (r * 299 + g * 587 + b * 114) / 1000
}

describe('THEMES — ordering and labels', () => {
  it('lists exactly four themes in declaration order (dark first = app default)', () => {
    expect(THEMES.map((t) => t.name)).toEqual(['dark', 'light', 'soft-light', 'ultra-dark'])
  })

  it('uses the expected human labels', () => {
    expect(THEMES.map((t) => t.label)).toEqual(['Tokyo Night', 'Light', 'Soft Light', 'Ultra Dark'])
  })

  it('labels are unique and trimmed', () => {
    const labels = THEMES.map((t) => t.label)
    expect(new Set(labels).size).toBe(labels.length)
    for (const l of labels) expect(l).toBe(l.trim())
  })

  it('splits evenly into two dark and two light themes', () => {
    expect(THEMES.filter((t) => t.isDark).map((t) => t.name)).toEqual(['dark', 'ultra-dark'])
    expect(THEMES.filter((t) => !t.isDark).map((t) => t.name)).toEqual(['light', 'soft-light'])
  })

  it('claudeTheme only ever takes the two supported values', () => {
    for (const t of THEMES) {
      expect(['dark', 'light']).toContain(t.claudeTheme)
    }
  })
})

describe('THEMES — cross-field consistency', () => {
  it.each(EXPECTED_NAMES)('%s: terminal background equals UI bg', (name) => {
    const t = byName(name)
    expect(t.terminal.background).toBe(t.colors.bg)
  })

  it.each(EXPECTED_NAMES)('%s: terminal foreground equals UI text color', (name) => {
    const t = byName(name)
    expect(t.terminal.foreground).toBe(t.colors.text)
  })

  it.each(EXPECTED_NAMES)('%s: accent and accent-hover are distinct', (name) => {
    const t = byName(name)
    expect(t.colors.accent).not.toBe(t.colors['accent-hover'])
  })

  it.each(EXPECTED_NAMES)('%s: bg, bg-secondary and bg-tertiary are all distinct', (name) => {
    const t = byName(name)
    const bgs = [t.colors.bg, t.colors['bg-secondary'], t.colors['bg-tertiary']]
    expect(new Set(bgs).size).toBe(3)
  })

  it.each(EXPECTED_NAMES)('%s: selection background differs from terminal background', (name) => {
    const t = byName(name)
    expect(t.terminal.selectionBackground).not.toBe(t.terminal.background)
  })

  it.each(EXPECTED_NAMES)('%s: cursor color is either the accent or the text color', (name) => {
    const t = byName(name)
    expect([t.colors.accent, t.colors.text]).toContain(t.terminal.cursor)
  })

  it('background colors are unique across themes', () => {
    const bgs = THEMES.map((t) => t.colors.bg)
    expect(new Set(bgs).size).toBe(THEMES.length)
  })
})

describe('THEMES — color formats and contrast', () => {
  it('all UI colors are 6-digit lowercase hex', () => {
    for (const t of THEMES) {
      for (const value of Object.values(t.colors)) {
        expect(value).toMatch(/^#[0-9a-f]{6}$/)
      }
    }
  })

  it('terminal colors are 6-digit hex except selectionBackground which may carry alpha', () => {
    for (const t of THEMES) {
      for (const [key, value] of Object.entries(t.terminal)) {
        if (key === 'selectionBackground') {
          expect(value).toMatch(/^#[0-9a-f]{6}([0-9a-f]{2})?$/)
        } else {
          expect(value).toMatch(/^#[0-9a-f]{6}$/)
        }
      }
    }
  })

  it.each(EXPECTED_NAMES)('%s: isDark agrees with the actual bg brightness', (name) => {
    const t = byName(name)
    const brightness = hexBrightness(t.colors.bg)
    if (t.isDark) {
      expect(brightness).toBeLessThan(128)
    } else {
      expect(brightness).toBeGreaterThanOrEqual(128)
    }
  })

  it.each(EXPECTED_NAMES)('%s: text contrasts against bg (brightness gap > 100)', (name) => {
    const t = byName(name)
    const gap = Math.abs(hexBrightness(t.colors.text) - hexBrightness(t.colors.bg))
    expect(gap).toBeGreaterThan(100)
  })

  it.each(EXPECTED_NAMES)('%s: muted text sits between bg and text brightness', (name) => {
    const t = byName(name)
    const bg = hexBrightness(t.colors.bg)
    const text = hexBrightness(t.colors.text)
    const muted = hexBrightness(t.colors['text-muted'])
    const [lo, hi] = bg < text ? [bg, text] : [text, bg]
    expect(muted).toBeGreaterThan(lo)
    expect(muted).toBeLessThan(hi)
  })
})

describe('THEMES — consumer lookup pattern', () => {
  // The app resolves themes with THEMES.find(...) ?? THEMES[0] / ?? 'dark'
  // (settingsStore.getClaudeTheme, useTerminal). These tests pin the
  // assumptions that fallback code relies on.
  it('find() on an unknown name yields undefined, so ?? fallbacks engage', () => {
    expect(THEMES.find((t) => t.name === ('solarized' as ThemeName))).toBeUndefined()
  })

  it('THEMES[0] — the fallback theme — is Tokyo Night dark', () => {
    expect(THEMES[0].name).toBe('dark')
    expect(THEMES[0].isDark).toBe(true)
    expect(THEMES[0].claudeTheme).toBe('dark')
  })

  it('find() resolves every declared ThemeName', () => {
    for (const name of EXPECTED_NAMES) {
      expect(THEMES.find((t) => t.name === name)).toBeDefined()
    }
  })

  it('lookup is case-sensitive ("Dark" does not resolve)', () => {
    expect(THEMES.find((t) => (t.name as string) === 'Dark')).toBeUndefined()
  })
})
