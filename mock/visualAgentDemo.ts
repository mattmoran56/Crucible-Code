/**
 * Demo Visual Agent conversation for Storybook / e2e / the mock app.
 *
 * Covers every card the chat UI draws: user + assistant markdown text,
 * thinking, Read / Edit / Bash tool calls with results, a Task sub-agent whose
 * child events sit under its tool id as threadId, a session event, a result,
 * and one pending permission ask (no ask-result yet).
 */
import {
  DEFAULT_VISUAL_AGENT_MODEL,
  type VisualAgentEvent,
  type VisualAgentFork,
  type VisualAgentSnapshot,
} from '../src/shared/visual-agent'

export const DEMO_CLAUDE_SESSION_ID = '5f0c2a8e-7d41-4b1e-9a43-2c1d9e0b7f10'
export const DEMO_CWD = '/Users/demo/code/acme-web'
export const DEMO_TASK_TOOL_ID = 'toolu_demo_task_01'
export const DEMO_ASK_ID = 'ask-demo-bash-01'

const T0 = Date.parse('2026-10-21T09:00:00.000Z')
const at = (seconds: number): string => new Date(T0 + seconds * 1000).toISOString()

type Body = VisualAgentEvent extends infer E ? (E extends unknown ? Omit<E, 'uuid' | 'seq' | 'at' | 'threadId'> : never) : never

let seq = 0
const ev = (seconds: number, body: Body, threadId = 'main'): VisualAgentEvent =>
  ({ uuid: `demo-${seq}`, seq: seq++, threadId, at: at(seconds), ...body }) as VisualAgentEvent

export const demoVisualAgentEvents: VisualAgentEvent[] = [
  ev(0, {
    kind: 'session',
    claudeSessionId: DEMO_CLAUDE_SESSION_ID,
    model: DEFAULT_VISUAL_AGENT_MODEL,
    cwd: DEMO_CWD,
    tools: ['Task', 'Bash', 'Edit', 'Read', 'Glob', 'Grep', 'Write', 'WebFetch', 'AskUserQuestion'],
    mcpFailed: [],
  }),
  ev(1, {
    kind: 'text',
    role: 'user',
    text: 'The login button on `/signin` does nothing on Safari. Can you find out why and fix it?',
  }),
  ev(3, {
    kind: 'thinking',
    text: 'Probably the click handler or a form submit being prevented. Start with the SignIn component.',
  }),
  ev(4, {
    kind: 'text',
    role: 'assistant',
    text: "I'll start by reading the sign-in form to see how the button is wired up.",
  }),
  ev(5, {
    kind: 'tool',
    id: 'toolu_demo_read_01',
    name: 'Read',
    input: { file_path: `${DEMO_CWD}/src/pages/SignIn.tsx` },
    spawnsThread: false,
  }),
  ev(6, {
    kind: 'tool-result',
    id: 'toolu_demo_read_01',
    ok: true,
    text: [
      '1\timport { useState } from "react"',
      '2\t',
      '3\texport function SignIn() {',
      '4\t  const [email, setEmail] = useState("")',
      '5\t  return (',
      '6\t    <form onSubmit={(e) => e.preventDefault()}>',
      '7\t      <button type="button" onPointerUp={submit}>Sign in</button>',
      '8\t    </form>',
      '9\t  )',
      '10\t}',
    ].join('\n'),
  }),
  ev(8, {
    kind: 'tool',
    id: DEMO_TASK_TOOL_ID,
    name: 'Task',
    input: {
      description: 'Check Safari pointer events',
      subagent_type: 'Explore',
      prompt: 'Find every onPointerUp handler in src/ and check whether Safari fires it for buttons.',
    },
    spawnsThread: true,
  }),
  ev(
    9,
    { kind: 'text', role: 'assistant', text: 'Searching for pointer handlers across `src/`.' },
    DEMO_TASK_TOOL_ID
  ),
  ev(
    10,
    { kind: 'tool', id: 'toolu_demo_grep_01', name: 'Grep', input: { pattern: 'onPointerUp', path: 'src' }, spawnsThread: false },
    DEMO_TASK_TOOL_ID
  ),
  ev(
    11,
    { kind: 'tool-result', id: 'toolu_demo_grep_01', ok: true, text: 'src/pages/SignIn.tsx:7' },
    DEMO_TASK_TOOL_ID
  ),
  ev(
    12,
    {
      kind: 'text',
      role: 'assistant',
      text: 'Only one handler: `SignIn.tsx:7`. Safari does not fire `pointerup` on a `<button>` inside a `<form>` when the pointer is a trackpad tap.',
    },
    DEMO_TASK_TOOL_ID
  ),
  ev(13, {
    kind: 'tool-result',
    id: DEMO_TASK_TOOL_ID,
    ok: true,
    text: 'Only SignIn.tsx:7 uses onPointerUp. Safari trackpad taps do not fire it on form buttons — use onClick / form submit instead.',
  }),
  ev(15, {
    kind: 'tool',
    id: 'toolu_demo_edit_01',
    name: 'Edit',
    input: {
      file_path: `${DEMO_CWD}/src/pages/SignIn.tsx`,
      old_string: '    <form onSubmit={(e) => e.preventDefault()}>\n      <button type="button" onPointerUp={submit}>Sign in</button>',
      new_string: '    <form onSubmit={(e) => { e.preventDefault(); submit() }}>\n      <button type="submit">Sign in</button>',
    },
    spawnsThread: false,
  }),
  ev(16, {
    kind: 'tool-result',
    id: 'toolu_demo_edit_01',
    ok: true,
    text: `The file ${DEMO_CWD}/src/pages/SignIn.tsx has been updated.`,
  }),
  ev(17, {
    kind: 'tool',
    id: 'toolu_demo_bash_01',
    name: 'Bash',
    input: { command: 'npm test -- SignIn', description: 'Run the SignIn tests' },
    spawnsThread: false,
  }),
  ev(25, {
    kind: 'tool-result',
    id: 'toolu_demo_bash_01',
    ok: true,
    text: ' PASS  src/pages/SignIn.test.tsx\n  ✓ submits on click (41 ms)\n  ✓ submits on Enter (12 ms)\n\nTests: 2 passed, 2 total',
  }),
  ev(27, {
    kind: 'text',
    role: 'assistant',
    text: [
      'Fixed. The button used `onPointerUp`, which **Safari does not fire** for trackpad taps on a form button.',
      '',
      '### Change',
      '- `src/pages/SignIn.tsx`: the button is now `type="submit"` and the form\'s `onSubmit` calls `submit()`.',
      '',
      'This also makes Enter-to-submit work. Tests pass:',
      '',
      '```',
      'Tests: 2 passed, 2 total',
      '```',
    ].join('\n'),
  }),
  ev(27, {
    kind: 'result',
    ok: true,
    costUsd: 0.1834,
    durationMs: 26_400,
    usage: { input: 1240, output: 1876, cacheRead: 48_210, cacheWrite: 11_390 },
    text: 'Fixed.',
  }),
  ev(40, { kind: 'text', role: 'user', text: 'Great — can you push it?' }),
  ev(42, {
    kind: 'tool',
    id: 'toolu_demo_bash_02',
    name: 'Bash',
    input: { command: 'git push origin HEAD', description: 'Push the branch' },
    spawnsThread: false,
  }),
  ev(42, {
    kind: 'ask',
    id: DEMO_ASK_ID,
    tool: 'Bash',
    input: { command: 'git push origin HEAD', description: 'Push the branch' },
    toolUseId: 'toolu_demo_bash_02',
    description: 'Push the branch',
    reason: 'Pushing to a remote affects shared state',
    canAlwaysAllow: true,
  }),
]

export const demoVisualAgentFork: VisualAgentFork = {
  id: 'fork-demo-01',
  question: 'Why not just add a click handler too?',
  startedAt: at(30),
  afterSeq: 18,
  state: 'done',
  events: [
    {
      uuid: 'demo-fork-0',
      seq: 0,
      threadId: 'main',
      at: at(33),
      kind: 'text',
      role: 'assistant',
      text: 'Both handlers would fire on most browsers, so the form would submit twice. A `type="submit"` button is the single path every browser agrees on.',
    },
    {
      uuid: 'demo-fork-1',
      seq: 1,
      threadId: 'main',
      at: at(33),
      kind: 'result',
      ok: true,
      costUsd: 0.0121,
      durationMs: 2900,
      usage: { input: 30, output: 52, cacheRead: 50_100, cacheWrite: 0 },
      text: '',
    },
  ],
}

export function demoVisualAgentSnapshot(agentId: string): VisualAgentSnapshot {
  return {
    agentId,
    claudeSessionId: DEMO_CLAUDE_SESSION_ID,
    model: DEFAULT_VISUAL_AGENT_MODEL,
    state: 'needs-input',
    events: demoVisualAgentEvents.map((e) => ({ ...e })),
    partial: null,
    usage: { input: 1240, output: 1876, total: 1240 + 1876 + 48_210 + 11_390 },
    forks: [{ ...demoVisualAgentFork, events: [...demoVisualAgentFork.events] }],
    turnStartedAt: at(40),
  }
}
