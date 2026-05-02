import { describe, expect, it } from 'vitest'
import { INTERVENTION_PATTERNS } from '../../../src/shared/patterns'

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
