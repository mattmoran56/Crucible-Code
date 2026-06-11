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

  it('is idempotent on an already-empty store', () => {
    useClaudeWebStore.getState().clear()
    useClaudeWebStore.getState().clear()
    expect(useClaudeWebStore.getState().sessions).toEqual([])
    expect(useClaudeWebStore.getState().loading).toBe(false)
  })
})

describe('claudeWebStore.loadSessions replacement semantics', () => {
  it('replaces previously loaded sessions rather than appending', async () => {
    useClaudeWebStore.setState({ sessions: [sample('claude/old', 9000)] as any })
    listSessions.mockResolvedValue([sample('claude/new', 1000)])
    await useClaudeWebStore.getState().loadSessions('/repo', 'claude/', null)
    expect(useClaudeWebStore.getState().sessions.map((s) => s.branchName)).toEqual(['claude/new'])
  })

  it('an empty result clears existing sessions', async () => {
    useClaudeWebStore.setState({ sessions: [sample('claude/old', 9000)] as any })
    listSessions.mockResolvedValue([])
    await useClaudeWebStore.getState().loadSessions('/repo', 'claude/', null)
    expect(useClaudeWebStore.getState().sessions).toEqual([])
  })

  it('a failed reload keeps the previously loaded sessions intact', async () => {
    useClaudeWebStore.setState({ sessions: [sample('claude/keep', 9000)] as any })
    listSessions.mockRejectedValue(new Error('git fetch failed'))
    await useClaudeWebStore.getState().loadSessions('/repo', 'claude/', null)
    expect(useClaudeWebStore.getState().sessions.map((s) => s.branchName)).toEqual(['claude/keep'])
    expect(useClaudeWebStore.getState().loading).toBe(false)
  })

  it('the last of two sequential loads wins', async () => {
    listSessions
      .mockResolvedValueOnce([sample('claude/first', 1000)])
      .mockResolvedValueOnce([sample('claude/second', 1000)])
    await useClaudeWebStore.getState().loadSessions('/repo', 'claude/', null)
    await useClaudeWebStore.getState().loadSessions('/repo', 'claude/', null)
    expect(useClaudeWebStore.getState().sessions.map((s) => s.branchName)).toEqual(['claude/second'])
    expect(listSessions).toHaveBeenCalledTimes(2)
  })

  it('preserves the order returned by the api without re-sorting', async () => {
    listSessions.mockResolvedValue([
      sample('claude/z-newest', 500),
      sample('claude/a-oldest', 90_000),
      sample('claude/m-middle', 5_000),
    ])
    await useClaudeWebStore.getState().loadSessions('/repo', 'claude/', null)
    expect(useClaudeWebStore.getState().sessions.map((s) => s.branchName)).toEqual([
      'claude/z-newest',
      'claude/a-oldest',
      'claude/m-middle',
    ])
  })

  it('forwards an undefined prefix and null login verbatim', async () => {
    listSessions.mockResolvedValue([])
    await useClaudeWebStore.getState().loadSessions('/repo', undefined, null)
    expect(listSessions).toHaveBeenCalledWith('/repo', undefined, null)
  })

  it('stays loading while an eventually-failing call is in flight', async () => {
    let reject: (e: unknown) => void = () => {}
    listSessions.mockImplementationOnce(() => new Promise((_, rej) => { reject = rej }))
    const promise = useClaudeWebStore.getState().loadSessions('/repo', 'claude/', null)
    expect(useClaudeWebStore.getState().loading).toBe(true)
    reject(new Error('network'))
    await promise
    expect(useClaudeWebStore.getState().loading).toBe(false)
  })

  it('clear() during an in-flight load is later overwritten by the load result (current behavior)', async () => {
    let resolve: (v: any) => void = () => {}
    listSessions.mockImplementationOnce(() => new Promise((r) => { resolve = r }))
    const promise = useClaudeWebStore.getState().loadSessions('/repo', 'claude/', null)
    useClaudeWebStore.getState().clear()
    expect(useClaudeWebStore.getState().loading).toBe(false)
    resolve([sample('claude/late', 100)])
    await promise
    expect(useClaudeWebStore.getState().sessions.map((s) => s.branchName)).toEqual(['claude/late'])
  })
})
