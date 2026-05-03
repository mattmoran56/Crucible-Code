import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useClaudeWebStore } from '../../../src/renderer/stores/claudeWebStore'

const listSessions = vi.fn()

beforeEach(() => {
  listSessions.mockReset()
  ;(window as any).api = {
    claudeWeb: { listSessions },
  }
  useClaudeWebStore.setState({ sessions: [], loading: false })
})

const sample = (branch: string, ago: number) => ({
  branchName: branch,
  headSha: 'sha-' + branch,
  lastCommitDate: new Date(Date.now() - ago).toISOString(),
  authorName: 'Matt',
})

describe('claudeWebStore.loadSessions', () => {
  it('populates sessions from the api result', async () => {
    listSessions.mockResolvedValue([sample('claude/a', 1000), sample('claude/b', 2000)])
    await useClaudeWebStore.getState().loadSessions('/repo', 'claude/', 'mattmoran')
    const state = useClaudeWebStore.getState()
    expect(state.sessions.map((s) => s.branchName)).toEqual(['claude/a', 'claude/b'])
    expect(state.loading).toBe(false)
  })

  it('passes the prefix and login through to the api', async () => {
    listSessions.mockResolvedValue([])
    await useClaudeWebStore.getState().loadSessions('/repo', 'bot/claude/', 'mattmoran')
    expect(listSessions).toHaveBeenCalledWith('/repo', 'bot/claude/', 'mattmoran')
  })

  it('keeps loading false even if the api throws', async () => {
    listSessions.mockRejectedValue(new Error('boom'))
    await useClaudeWebStore.getState().loadSessions('/repo', undefined, null)
    expect(useClaudeWebStore.getState().loading).toBe(false)
  })

  it('flips loading=true while in flight', async () => {
    let resolve: (v: any) => void = () => {}
    listSessions.mockImplementationOnce(
      () => new Promise((r) => { resolve = r })
    )
    const promise = useClaudeWebStore.getState().loadSessions('/repo', undefined, null)
    expect(useClaudeWebStore.getState().loading).toBe(true)
    resolve([])
    await promise
    expect(useClaudeWebStore.getState().loading).toBe(false)
  })
})

describe('claudeWebStore.clear', () => {
  it('empties sessions and resets loading', () => {
    useClaudeWebStore.setState({
      sessions: [sample('claude/a', 1000)],
      loading: true,
    })
    useClaudeWebStore.getState().clear()
    expect(useClaudeWebStore.getState().sessions).toEqual([])
    expect(useClaudeWebStore.getState().loading).toBe(false)
  })
})
