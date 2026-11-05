import { describe, expect, it } from 'vitest'
import {
  DISPATCH_MCP_INSTRUCTIONS,
  DISPATCH_TOOLS,
  parseDispatchSessionArgs,
  parseSendToSessionArgs,
} from '../../../src/shared/session-dispatch'

describe('parseDispatchSessionArgs', () => {
  it('defaults to a local, single-branch worktree session', () => {
    expect(parseDispatchSessionArgs({ task: '  Fix the bug  ' })).toEqual({
      task: 'Fix the bug',
      name: undefined,
      location: 'local',
      worktree: true,
      baseBranch: undefined,
      branchName: undefined,
      mode: 'single-branch',
    })
  })

  it('maps the snake_case options', () => {
    expect(
      parseDispatchSessionArgs({
        task: 't',
        name: 'Fix login',
        location: 'cloud',
        base_branch: 'develop',
        branch_name: 'feat/login',
        mode: 'orchestrator',
      })
    ).toMatchObject({ name: 'Fix login', location: 'cloud', baseBranch: 'develop', branchName: 'feat/login', mode: 'orchestrator' })
  })

  it('requires a task', () => {
    expect(() => parseDispatchSessionArgs({})).toThrow('"task" is required')
    expect(() => parseDispatchSessionArgs({ task: '   ' })).toThrow('"task" is required')
    expect(() => parseDispatchSessionArgs(undefined)).toThrow('"task" is required')
  })

  it('rejects bad values', () => {
    expect(() => parseDispatchSessionArgs({ task: 't', location: 'mars' })).toThrow('"location"')
    expect(() => parseDispatchSessionArgs({ task: 't', worktree: 'no' })).toThrow('"worktree"')
    expect(() => parseDispatchSessionArgs({ task: 't', mode: 'free' })).toThrow('"mode"')
    expect(() => parseDispatchSessionArgs({ task: 7 })).toThrow('"task" must be a string')
    expect(() => parseDispatchSessionArgs([])).toThrow('object')
  })

  it('allows a no-worktree session only locally, without branch options', () => {
    expect(parseDispatchSessionArgs({ task: 't', worktree: false }).worktree).toBe(false)
    expect(() => parseDispatchSessionArgs({ task: 't', worktree: false, location: 'cloud' })).toThrow('needs a worktree')
    expect(() => parseDispatchSessionArgs({ task: 't', worktree: false, branch_name: 'x' })).toThrow('need a worktree')
    expect(() => parseDispatchSessionArgs({ task: 't', worktree: false, mode: 'orchestrator' })).toThrow('needs a worktree')
  })
})

describe('parseSendToSessionArgs', () => {
  it('needs a session id and a message', () => {
    expect(parseSendToSessionArgs({ session_id: 'a', message: ' hi ' })).toEqual({ sessionId: 'a', message: 'hi' })
    expect(() => parseSendToSessionArgs({ message: 'hi' })).toThrow('"session_id"')
    expect(() => parseSendToSessionArgs({ session_id: 'a' })).toThrow('"message"')
  })
})

describe('tool definitions and instructions', () => {
  it('only requires the task for dispatch_session', () => {
    const dispatch = DISPATCH_TOOLS.find((t) => t.name === 'dispatch_session')!
    expect(dispatch.inputSchema.required).toEqual(['task'])
  })

  it('tell the agent the defaults: local, one worktree and PR per task, cloud on request', () => {
    expect(DISPATCH_MCP_INSTRUCTIONS).toContain('dispatch_session')
    expect(DISPATCH_MCP_INSTRUCTIONS).toMatch(/one worktree session per task/i)
    expect(DISPATCH_MCP_INSTRUCTIONS).toMatch(/locally by default/i)
    expect(DISPATCH_MCP_INSTRUCTIONS).toMatch(/cloud/)
  })
})
