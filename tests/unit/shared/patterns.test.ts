import { describe, expect, it } from 'vitest'
import { INTERVENTION_PATTERNS, detectUsageLimit } from '../../../src/shared/patterns'

function matchesAny(text: string): boolean {
  return INTERVENTION_PATTERNS.some((p) => p.test(text))
}

describe('INTERVENTION_PATTERNS', () => {
  it.each([
    'Do you want to proceed?',
    'do you want to proceed?',
    'Continue? (y/n)',
    'Continue? (Y/N)',
    'Continue? [Y/n]',
    'Continue [yes/no]',
    'Are you sure?',
    'Press Enter to continue',
    'Allow once',
    'Allow always',
    'Deny',
    'Do you want to allow this command?',
  ])('detects intervention prompt: %s', (line) => {
    expect(matchesAny(line)).toBe(true)
  })

  it.each([
    'Just some normal output',
    'Building project...',
    '✔ build succeeded',
    'Press the button to continue', // no Enter
    'allow this',                    // not the structured Allow once/always
  ])('does not flag normal output: %s', (line) => {
    expect(matchesAny(line)).toBe(false)
  })
})

describe('INTERVENTION_PATTERNS — structure', () => {
  it('contains exactly 8 patterns', () => {
    expect(INTERVENTION_PATTERNS).toHaveLength(8)
  })

  it('every entry is a RegExp', () => {
    for (const p of INTERVENTION_PATTERNS) {
      expect(p).toBeInstanceOf(RegExp)
    }
  })

  it('no pattern carries the global flag (g makes .test() stateful via lastIndex)', () => {
    for (const p of INTERVENTION_PATTERNS) {
      expect(p.flags).not.toContain('g')
    }
  })

  it('repeated .test() calls on the same pattern are stable (no lastIndex drift)', () => {
    const line = 'Do you want to proceed?'
    for (let i = 0; i < 5; i++) {
      expect(matchesAny(line)).toBe(true)
    }
  })

  it('the [Y/n] pattern is intentionally case-sensitive', () => {
    const p = INTERVENTION_PATTERNS.find((r) => r.source === '\\[Y\\/n\\]')!
    expect(p).toBeDefined()
    expect(p.flags).not.toContain('i')
  })

  it('the Allow once/Allow always/Deny pattern is intentionally case-sensitive', () => {
    const p = INTERVENTION_PATTERNS.find((r) => r.source === 'Allow once|Allow always|Deny')!
    expect(p).toBeDefined()
    expect(p.flags).not.toContain('i')
  })
})

describe('INTERVENTION_PATTERNS — realistic terminal lines that should match', () => {
  it.each([
    'Bash command: rm -rf node_modules — Do you want to proceed?',
    '│ Do you want to proceed? │',
    'do you want to PROCEED?',
    '[1mAre you sure?[0m',
    'Are you sure? This action cannot be undone.',
    'Overwrite existing file? (y/n)',
    'Continue with install? (Y/N): ',
    'Do you want to continue? [Y/n] ',
    'Proceed anyway? [yes/no]',
    'Remove stale containers? [YES/NO]',
    'Press Enter to continue, or Ctrl+C to abort',
    'PRESS ENTER TO CONTINUE...',
    '❯ 1. Allow once',
    '  2. Allow always',
    '  3. Deny (esc)',
    'Do you want to allow Claude to run this command?',
    'do you want to allow access to ~/.ssh?',
    'foo output\nDo you want to proceed?\nmore output',
    'Are you sure? (y/N)',
  ])('matches: %s', (line) => {
    expect(matchesAny(line)).toBe(true)
  })

  it('matches "Deny" as a bare menu entry', () => {
    expect(matchesAny('Deny')).toBe(true)
  })

  it('matches even when the prompt is buried in a huge chunk of output', () => {
    const chunk = 'x'.repeat(500_000) + '\nDo you want to proceed?\n' + 'y'.repeat(500_000)
    expect(matchesAny(chunk)).toBe(true)
  })

  // Substring matching means "Deny" fires inside larger words that start
  // with it — current (slightly overeager) behavior.
  it('matches "Denylist updated" via the Deny substring (current behavior)', () => {
    expect(matchesAny('Denylist updated')).toBe(true)
  })
})

describe('INTERVENTION_PATTERNS — realistic terminal lines that should NOT match', () => {
  it.each([
    '',
    ' ',
    '$ npm run build',
    'added 120 packages in 3s',
    "Cloning into 'repo'...",
    'warning: LF will be replaced by CRLF in src/index.ts',
    'PASS tests/unit/foo.test.ts',
    "error TS2345: Argument of type 'string' is not assignable",
    'Compiled successfully in 1243ms',
    'Proceeding with installation',
    'Permission denied (publickey)',
    'Denied',                  // "Deny" is not a substring of "Denied"
    'deny',                    // lowercase — Deny pattern is case-sensitive
    'allow always',            // lowercase — Allow pattern is case-sensitive
    'Allow',                   // bare word without once/always
    'y/n',                     // no parentheses
    '(yes/no)',                // parens version is only matched for y/n
    '[y/n]',                   // [Y/n] pattern requires uppercase Y
    '[Y/N]',                   // ...and lowercase n
    'Overwrite existing file? [y/N]', // inverted-default variant is missed (current behavior)
    'Do you want to proceed with the deployment?', // "?" must directly follow "proceed"
    'Are you sure you want to continue connecting (yes/no/[fingerprint])?', // ssh prompt is missed (current behavior)
    'Press any key to continue',
    'Pressing Enter now would continue', // phrase must be literal "Press Enter to continue"
    '私はターミナルです 🚀',
  ])('does not match: %s', (line) => {
    expect(matchesAny(line)).toBe(false)
  })

  it('does not match a huge chunk of benign output', () => {
    expect(matchesAny('build output line\n'.repeat(50_000))).toBe(false)
  })
})

describe('INTERVENTION_PATTERNS — per-pattern behavior', () => {
  const bySource = (source: string): RegExp => {
    const p = INTERVENTION_PATTERNS.find((r) => r.source === source)
    if (!p) throw new Error(`pattern not found: ${source}`)
    return p
  }

  it('(y/n) is case-insensitive but requires the parentheses', () => {
    const p = bySource('\\(y\\/n\\)')
    expect(p.test('(y/n)')).toBe(true)
    expect(p.test('(Y/N)')).toBe(true)
    expect(p.test('(y/N)')).toBe(true)
    expect(p.test('y/n')).toBe(false)
    expect(p.test('(yn)')).toBe(false)
  })

  it('[Y/n] matches only the exact default-yes capitalization', () => {
    const p = bySource('\\[Y\\/n\\]')
    expect(p.test('Do you want to continue? [Y/n]')).toBe(true)
    expect(p.test('[y/N]')).toBe(false)
    expect(p.test('[Y/N]')).toBe(false)
    expect(p.test('[y/n]')).toBe(false)
  })

  it('[yes/no] accepts any capitalization', () => {
    const p = bySource('\\[yes\\/no\\]')
    expect(p.test('[yes/no]')).toBe(true)
    expect(p.test('[Yes/No]')).toBe(true)
    expect(p.test('[YES/NO]')).toBe(true)
    expect(p.test('yes/no')).toBe(false)
  })

  it('"Do you want to proceed?" requires the question mark', () => {
    const p = bySource('Do you want to proceed\\?')
    expect(p.test('Do you want to proceed?')).toBe(true)
    expect(p.test('Do you want to proceed')).toBe(false)
  })

  it('"Are you sure?" requires the question mark immediately after "sure"', () => {
    const p = bySource('Are you sure\\?')
    expect(p.test('Are you sure?')).toBe(true)
    expect(p.test('Are you sure about this?')).toBe(false)
  })

  it('"Press Enter to continue" matches mid-sentence and any case', () => {
    const p = bySource('Press Enter to continue')
    expect(p.test('-- press enter to continue --')).toBe(true)
    expect(p.test('Press Enter to quit')).toBe(false)
  })

  it('"Do you want to allow" matches with any continuation text', () => {
    const p = bySource('Do you want to allow')
    expect(p.test('Do you want to allow this tool to edit files?')).toBe(true)
    expect(p.test('Do you want to deny this?')).toBe(false)
  })
})

describe('detectUsageLimit — genuine block banners', () => {
  it('detects the interactive session-limit banner and maps the window', () => {
    expect(detectUsageLimit("You've hit your session limit · resets 3:45pm")).toEqual({ kind: 'session' })
  })

  it('detects the weekly-limit banner', () => {
    expect(detectUsageLimit("You've hit your weekly limit · resets Mon 12:00am")).toEqual({ kind: 'weekly' })
  })

  it('detects the Opus-limit banner', () => {
    expect(detectUsageLimit("You've hit your Opus limit · resets 3:45pm")).toEqual({ kind: 'opus' })
  })

  it('maps a bare "usage limit" wording to generic', () => {
    expect(detectUsageLimit("You've hit your usage limit")).toEqual({ kind: 'generic' })
  })

  it('detects the older "Claude usage limit reached" phrasing', () => {
    expect(detectUsageLimit('Claude usage limit reached. Your limit will reset at 2pm (America/New_York)'))
      .toEqual({ kind: 'generic' })
  })

  it('parses the inline reset timestamp from the headless print-mode banner', () => {
    expect(detectUsageLimit('Claude AI usage limit reached|1760000400'))
      .toEqual({ kind: 'generic', resetsAt: 1760000400 })
  })

  it('sees through ANSI styling and box-drawing around the banner', () => {
    const styled = "\x1b[31m│\x1b[0m You've hit your \x1b[1msession\x1b[0m limit · resets 3:45pm \x1b[31m│\x1b[0m"
    expect(detectUsageLimit(styled)).toEqual({ kind: 'session' })
  })

  it('matches a banner split so the wording spans the concatenated tail', () => {
    // Simulates two PTY chunks already joined into the scan tail.
    expect(detectUsageLimit("noise\nYou've hit your sess" + 'ion limit · resets 4pm'))
      .toEqual({ kind: 'session' })
  })
})

describe('detectUsageLimit — non-blocking output stays quiet', () => {
  it.each([
    'Just some normal output',
    'Building project...',
    'API Error: Server is temporarily limiting requests (not your usage limit)',
    'API Error: Request rejected (429) · this may be a temporary capacity issue.',
    'rate_limit_error: This request would exceed your account\'s rate limit. Please try again later.',
    'five_hour 92% · seven_day 40%',
    'Your usage is approaching the limit',
    '',
  ])('returns null for: %s', (line) => {
    expect(detectUsageLimit(line)).toBeNull()
  })
})
