import { describe, expect, it } from 'vitest'
import { cloudNoticeKind } from '../../../src/shared/cloud-session'

describe('cloudNoticeKind', () => {
  it('reads finished sessions as completed', () => {
    expect(cloudNoticeKind('Session finished', 'Fix login redirect')).toBe('completed')
    expect(cloudNoticeKind('Claude is done', '')).toBe('completed')
  })
  it('reads anything asking for the user as attention', () => {
    expect(cloudNoticeKind('Claude needs your input', 'Approve running npm test?')).toBe('attention')
    expect(cloudNoticeKind('Finished — waiting for your reply', '')).toBe('attention')
    expect(cloudNoticeKind('Claude Code', 'Something happened')).toBe('attention')
  })
})
