// Story fixtures. The first half mirrors the backend's mock/visualAgentDemo.ts
// (copied rather than imported: tsconfig.web.json is a composite project that
// cannot pull in files from mock/). The second half adds rows that exercise the
// rest of the panel — MultiEdit/Write/TodoWrite cards, a nested sub-agent, a
// failed tool, compaction, retry, an AskUserQuestion prompt and a streaming
// partial.

import {
  DEFAULT_VISUAL_AGENT_MODEL,
  type VisualAgentEvent,
  type VisualAgentFork,
  type VisualAgentSnapshot,
} from '../../../../shared/visual-agent'

/* --- mirrored from mock/visualAgentDemo.ts -------------------------------- */

export const DEMO_CLAUDE_SESSION_ID = '5f0c2a8e-7d41-4b1e-9a43-2c1d9e0b7f10'
export const DEMO_CWD = '/Users/demo/code/acme-web'
export const DEMO_TASK_TOOL_ID = 'toolu_demo_task_01'
export const DEMO_ASK_ID = 'ask-demo-bash-01'

const DEMO_T0 = Date.parse('2026-10-21T09:00:00.000Z')
const demoAt = (seconds: number): string => new Date(DEMO_T0 + seconds * 1000).toISOString()

type DemoBody = VisualAgentEvent extends infer E ? (E extends unknown ? Omit<E, 'uuid' | 'seq' | 'at' | 'threadId'> : never) : never

let demoSeq = 0
const demoEv = (seconds: number, body: DemoBody, threadId = 'main'): VisualAgentEvent =>
  ({ uuid: `demo-${demoSeq}`, seq: demoSeq++, threadId, at: demoAt(seconds), ...body }) as VisualAgentEvent

export const demoVisualAgentEvents: VisualAgentEvent[] = [
  demoEv(0, {
    kind: 'session',
    claudeSessionId: DEMO_CLAUDE_SESSION_ID,
    model: DEFAULT_VISUAL_AGENT_MODEL,
    cwd: DEMO_CWD,
    tools: ['Task', 'Bash', 'Edit', 'Read', 'Glob', 'Grep', 'Write', 'WebFetch', 'AskUserQuestion'],
    mcpFailed: [],
  }),
  demoEv(1, {
    kind: 'text',
    role: 'user',
    text: 'The login button on `/signin` does nothing on Safari. Can you find out why and fix it?',
  }),
  demoEv(3, {
    kind: 'thinking',
    text: 'Probably the click handler or a form submit being prevented. Start with the SignIn component.',
  }),
  demoEv(4, {
    kind: 'text',
    role: 'assistant',
    text: "I'll start by reading the sign-in form to see how the button is wired up.",
  }),
  demoEv(5, {
    kind: 'tool',
    id: 'toolu_demo_read_01',
    name: 'Read',
    input: { file_path: `${DEMO_CWD}/src/pages/SignIn.tsx` },
    spawnsThread: false,
  }),
  demoEv(6, {
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
  demoEv(8, {
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
  demoEv(
    9,
    { kind: 'text', role: 'assistant', text: 'Searching for pointer handlers across `src/`.' },
    DEMO_TASK_TOOL_ID
  ),
  demoEv(
    10,
    { kind: 'tool', id: 'toolu_demo_grep_01', name: 'Grep', input: { pattern: 'onPointerUp', path: 'src' }, spawnsThread: false },
    DEMO_TASK_TOOL_ID
  ),
  demoEv(
    11,
    { kind: 'tool-result', id: 'toolu_demo_grep_01', ok: true, text: 'src/pages/SignIn.tsx:7' },
    DEMO_TASK_TOOL_ID
  ),
  demoEv(
    12,
    {
      kind: 'text',
      role: 'assistant',
      text: 'Only one handler: `SignIn.tsx:7`. Safari does not fire `pointerup` on a `<button>` inside a `<form>` when the pointer is a trackpad tap.',
    },
    DEMO_TASK_TOOL_ID
  ),
  demoEv(13, {
    kind: 'tool-result',
    id: DEMO_TASK_TOOL_ID,
    ok: true,
    text: 'Only SignIn.tsx:7 uses onPointerUp. Safari trackpad taps do not fire it on form buttons — use onClick / form submit instead.',
  }),
  demoEv(15, {
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
  demoEv(16, {
    kind: 'tool-result',
    id: 'toolu_demo_edit_01',
    ok: true,
    text: `The file ${DEMO_CWD}/src/pages/SignIn.tsx has been updated.`,
  }),
  demoEv(17, {
    kind: 'tool',
    id: 'toolu_demo_bash_01',
    name: 'Bash',
    input: { command: 'npm test -- SignIn', description: 'Run the SignIn tests' },
    spawnsThread: false,
  }),
  demoEv(25, {
    kind: 'tool-result',
    id: 'toolu_demo_bash_01',
    ok: true,
    text: ' PASS  src/pages/SignIn.test.tsx\n  ✓ submits on click (41 ms)\n  ✓ submits on Enter (12 ms)\n\nTests: 2 passed, 2 total',
  }),
  demoEv(27, {
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
  demoEv(27, {
    kind: 'result',
    ok: true,
    costUsd: 0.1834,
    durationMs: 26_400,
    usage: { input: 1240, output: 1876, cacheRead: 48_210, cacheWrite: 11_390 },
    text: 'Fixed.',
  }),
  demoEv(40, { kind: 'text', role: 'user', text: 'Great — can you push it?' }),
  demoEv(42, {
    kind: 'tool',
    id: 'toolu_demo_bash_02',
    name: 'Bash',
    input: { command: 'git push origin HEAD', description: 'Push the branch' },
    spawnsThread: false,
  }),
  demoEv(42, {
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
  startedAt: demoAt(30),
  afterSeq: 18,
  state: 'done',
  events: [
    {
      uuid: 'demo-fork-0',
      seq: 0,
      threadId: 'main',
      at: demoAt(33),
      kind: 'text',
      role: 'assistant',
      text: 'Both handlers would fire on most browsers, so the form would submit twice. A `type="submit"` button is the single path every browser agrees on.',
    },
    {
      uuid: 'demo-fork-1',
      seq: 1,
      threadId: 'main',
      at: demoAt(33),
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
    turnStartedAt: demoAt(40),
  }
}

/* --- extras ------------------------------------------------------------------ */

const T0 = Date.parse('2026-10-21T09:00:00.000Z')
const at = (seconds: number): string => new Date(T0 + seconds * 1000).toISOString()

type Body = VisualAgentEvent extends infer E ? (E extends unknown ? Omit<E, 'uuid' | 'seq' | 'at' | 'threadId'> : never) : never
let n = 0
const ev = (seconds: number, body: Body, threadId = 'main'): VisualAgentEvent =>
  ({ uuid: `fx-${n}`, seq: 1000 + n++, threadId, at: at(seconds), ...body }) as VisualAgentEvent

export const NESTED_TASK_ID = 'toolu_fx_task_nested'
export const AUDIT_TASK_ID = 'toolu_fx_task_audit'

/** A second turn: a todo list, a multi-file edit, a nested sub-agent, a failure and a compaction. */
export const extraEvents: VisualAgentEvent[] = [
  ev(60, { kind: 'text', role: 'user', text: 'While you are there, audit the other forms for the same bug and add a regression test.' }),
  ev(61, {
    kind: 'tool',
    id: 'toolu_fx_todo',
    name: 'TodoWrite',
    input: {
      todos: [
        { content: 'Audit forms for pointer-only handlers', status: 'completed', activeForm: 'Auditing forms' },
        { content: 'Fix ContactForm submit', status: 'in_progress', activeForm: 'Fixing ContactForm submit' },
        { content: 'Add Safari regression test', status: 'pending', activeForm: 'Adding regression test' },
      ],
    },
    spawnsThread: false,
  }),
  ev(61, { kind: 'tool-result', id: 'toolu_fx_todo', ok: true, text: 'Todos have been modified successfully.' }),
  ev(62, {
    kind: 'tool',
    id: AUDIT_TASK_ID,
    name: 'Task',
    input: { description: 'Audit forms', subagent_type: 'general-purpose', prompt: 'Audit every form in src/ for pointer-only submit handlers.' },
    spawnsThread: true,
  }),
  ev(63, { kind: 'text', role: 'assistant', text: 'I will split this: one helper per directory.' }, AUDIT_TASK_ID),
  ev(64, {
    kind: 'tool',
    id: NESTED_TASK_ID,
    name: 'Task',
    input: { description: 'Scan src/components', subagent_type: 'Explore', prompt: 'List forms in src/components.' },
    spawnsThread: true,
  }, AUDIT_TASK_ID),
  ev(65, { kind: 'tool', id: 'toolu_fx_glob', name: 'Glob', input: { pattern: 'src/components/**/*Form*.tsx' }, spawnsThread: false }, NESTED_TASK_ID),
  ev(66, { kind: 'tool-result', id: 'toolu_fx_glob', ok: true, text: 'src/components/ContactForm.tsx\nsrc/components/NewsletterForm.tsx' }, NESTED_TASK_ID),
  ev(67, { kind: 'text', role: 'assistant', text: 'Two forms: `ContactForm.tsx` and `NewsletterForm.tsx`.' }, NESTED_TASK_ID),
  ev(68, { kind: 'tool-result', id: NESTED_TASK_ID, ok: true, text: 'ContactForm.tsx, NewsletterForm.tsx' }, AUDIT_TASK_ID),
  ev(69, { kind: 'text', role: 'assistant', text: '`ContactForm` uses `onPointerUp`; `NewsletterForm` is fine.' }, AUDIT_TASK_ID),
  ev(70, { kind: 'tool-result', id: AUDIT_TASK_ID, ok: true, text: 'ContactForm.tsx needs the same fix.' }),
  ev(72, {
    kind: 'tool',
    id: 'toolu_fx_multiedit',
    name: 'MultiEdit',
    input: {
      file_path: `${DEMO_CWD}/src/components/ContactForm.tsx`,
      edits: [
        { old_string: '<form className="contact">', new_string: '<form className="contact" onSubmit={handleSubmit}>' },
        { old_string: '<button onPointerUp={handleSubmit}>Send</button>', new_string: '<button type="submit">Send</button>' },
      ],
    },
    spawnsThread: false,
  }),
  ev(72, { kind: 'tool-result', id: 'toolu_fx_multiedit', ok: true, text: 'Applied 2 edits.' }),
  ev(73, {
    kind: 'tool',
    id: 'toolu_fx_write',
    name: 'Write',
    input: {
      file_path: `${DEMO_CWD}/src/components/ContactForm.safari.test.tsx`,
      content: "import { render, screen } from '@testing-library/react'\nimport userEvent from '@testing-library/user-event'\nimport { ContactForm } from './ContactForm'\n\nit('submits on click', async () => {\n  const onSend = vi.fn()\n  render(<ContactForm onSend={onSend} />)\n  await userEvent.click(screen.getByRole('button', { name: 'Send' }))\n  expect(onSend).toHaveBeenCalled()\n})",
    },
    spawnsThread: false,
  }),
  ev(73, { kind: 'tool-result', id: 'toolu_fx_write', ok: true, text: 'File created.' }),
  ev(74, { kind: 'tool', id: 'toolu_fx_bash_fail', name: 'Bash', input: { command: 'npm run lint', description: 'Lint' }, spawnsThread: false }),
  ev(78, {
    kind: 'tool-result',
    id: 'toolu_fx_bash_fail',
    ok: false,
    text: "src/components/ContactForm.safari.test.tsx\n  6:18  error  'vi' is not defined  no-undef\n\n✖ 1 problem (1 error, 0 warnings)",
  }),
  ev(79, { kind: 'retry', attempt: 1, max: 10, delayMs: 1200, reason: 'overloaded_error' }),
  ev(80, { kind: 'compacted', tokensBefore: 168_400, trigger: 'auto' }),
  ev(81, {
    kind: 'note',
    source: 'hook',
    label: 'PostToolUse hook: prettier',
    text: 'Formatted 2 files.',
  }),
  ev(82, {
    kind: 'text',
    role: 'assistant',
    text: 'Lint flagged a missing `vi` import. Before I fix it — how would you like the tests organised?',
  }),
  ev(83, {
    kind: 'ask',
    id: 'ask-fx-question',
    tool: 'AskUserQuestion',
    input: {
      questions: [
        {
          question: 'Where should the Safari regression tests live?',
          header: 'Tests',
          multiSelect: false,
          options: [
            { label: 'Next to each form', description: 'ContactForm.safari.test.tsx' },
            { label: 'One shared file', description: 'tests/safari-forms.test.tsx' },
          ],
        },
      ],
    },
    toolUseId: 'toolu_fx_question',
    description: 'Claude has a question for you',
    reason: '',
    canAlwaysAllow: false,
  }),
]

/** The demo conversation with the push ask already allowed, followed by the extra turn. */
export const conversationEvents = (): VisualAgentEvent[] => {
  const base = demoVisualAgentEvents.map((e) => ({ ...e }))
  return [
    ...base,
    ev(43, { kind: 'ask-result', id: 'ask-demo-bash-01', decision: 'allow' }),
    ev(45, { kind: 'tool-result', id: 'toolu_demo_bash_02', ok: true, text: 'To github.com:acme/acme-web.git\n   3f2a1b0..9c8d7e6  HEAD -> fix/safari-signin' }),
    ev(46, { kind: 'text', role: 'assistant', text: 'Pushed `fix/safari-signin` to origin.' }),
    ev(46, { kind: 'result', ok: true, costUsd: 0.021, durationMs: 4100, usage: null, text: '' }),
    ...extraEvents.map((e) => ({ ...e })),
  ]
}

export const runningFork = (): VisualAgentFork => ({
  id: 'fork-fx-running',
  question: 'Is onPointerUp ever the right choice for a button?',
  startedAt: at(75),
  afterSeq: 1010,
  state: 'running',
  events: [],
})

/** The backend demo as-is (pending Bash permission ask). */
export const demoSnapshot = (agentId: string): VisualAgentSnapshot => demoVisualAgentSnapshot(agentId)

/** The fuller conversation: waiting on an AskUserQuestion. */
export const conversationSnapshot = (agentId: string): VisualAgentSnapshot => ({
  ...demoVisualAgentSnapshot(agentId),
  state: 'needs-input',
  events: conversationEvents(),
  forks: [{ ...demoVisualAgentFork, events: [...demoVisualAgentFork.events] }],
  turnStartedAt: new Date(Date.now() - 83_000).toISOString(),
  usage: { input: 4210, output: 2380, total: 6590 },
})

export const STREAMING_TEXT = [
  'The regression test needs `vi` from Vitest. I will add the import and re-run lint:',
  '',
  '```ts',
  "import { vi, it, expect } from 'vitest'",
  '```',
  '',
  'Then I will move both tests into',
].join('\n')

export const streamingSnapshot = (agentId: string): VisualAgentSnapshot => {
  const events = conversationEvents().filter((e) => !(e.kind === 'ask' && e.id === 'ask-fx-question'))
  return {
    ...conversationSnapshot(agentId),
    state: 'running',
    events: [
      ...events,
      ev(90, { kind: 'text', role: 'user', text: 'Next to each form. Go ahead.' }),
      ev(91, { kind: 'thinking', text: '' }),
    ],
    partial: { messageId: 'msg_fx_stream', threadId: 'main', text: STREAMING_TEXT },
    turnStartedAt: new Date(Date.now() - 12_000).toISOString(),
    usage: { input: 1180, output: 312, total: 1492 },
  }
}

export const emptySnapshotFixture = (agentId: string): VisualAgentSnapshot => ({
  agentId,
  claudeSessionId: '0b7e1f3c-2a9d-4c6e-8f10-5d4c3b2a1e09',
  model: 'claude-opus-5-5',
  state: 'idle',
  events: [],
  partial: null,
  usage: null,
  forks: [],
  turnStartedAt: null,
})
