import React, { useLayoutEffect, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import type { Session } from '../../../shared/types'
import { ATTACH_NOT_ENABLED } from '../../../shared/cloud-session'
import { CloudAgentPanel, type CloudAgentPhase } from './CloudAgentPanel'

/** A fixed cloud session — no clock-dependent fields, so baselines stay stable. */
const SESSION: Session = {
  id: 'story-cloud-session',
  name: 'fix-auth-refresh',
  branchName: 'session/fix-auth-refresh',
  worktreePath: '/Users/dev/.codecrucible-worktrees/CodeCrucible/fix-auth-refresh',
  projectId: 'proj-1',
  createdAt: '2026-10-20T09:00:00.000Z',
  lastActiveAt: '2026-10-21T08:30:00.000Z',
  baseBranch: 'main',
  location: 'cloud',
  cloud: {
    sessionId: 'session_01Hx7QmCloudDemo',
    url: 'https://claude.ai/code/session_01Hx7QmCloudDemo',
  },
}

const TELEPORTED_SESSION: Session = {
  ...SESSION,
  location: 'local',
  cloud: { ...SESSION.cloud!, teleportedAt: '2026-10-21T08:45:00.000Z' },
}

/** Canned terminal transcripts, printed by the mock bridge's fake PTY. */
const TRANSCRIPTS = {
  attach: [
    '\x1b[90m$ claude --cloud session_01Hx7QmCloudDemo\x1b[0m\r\n',
    '\x1b[36m☁ Attached to cloud session\x1b[0m — Claude is working in the cloud.\r\n\r\n',
    '\x1b[1m●\x1b[0m Reading src/auth/session.ts\r\n',
    '\x1b[1m●\x1b[0m Running npm test (in the cloud VM)\r\n',
    '  \x1b[32m✓ 214 passed\x1b[0m\r\n\r\n> ',
  ],
  unavailable: [
    '\x1b[90m$ claude --cloud session_01Hx7QmCloudDemo\x1b[0m\r\n',
    `\x1b[31m${ATTACH_NOT_ENABLED}.\x1b[0m\r\n`,
  ],
  teleport: [
    '\x1b[90m$ claude --teleport session_01Hx7QmCloudDemo\x1b[0m\r\n',
    'Fetching branch from origin…\r\n',
    'Checked out session branch. Loaded conversation history.\r\n\r\n> ',
  ],
  teleportEnded: [
    '\x1b[90m$ claude --teleport session_01Hx7QmCloudDemo\x1b[0m\r\n',
    'Checked out session branch. Loaded conversation history.\r\n\r\n',
    '\x1b[1m●\x1b[0m Done — the refresh token is now rotated on every use.\r\n',
    '\x1b[90mSession ended.\x1b[0m\r\n',
  ],
} satisfies Record<string, string[]>

interface MockBridge {
  __mock?: { pty?: (lines: string[]) => string }
}

interface StoryProps {
  session?: Session
  phase: CloudAgentPhase
  /** Which canned transcript to show in the terminal; none renders no terminal. */
  transcript?: keyof typeof TRANSCRIPTS
  error?: string | null
  dirtyFiles?: string[]
}

/** Spawns a fake PTY for the transcript (if any), then mounts the panel. */
function Harness({ session = SESSION, phase, transcript, error, dirtyFiles }: StoryProps) {
  const [terminalId, setTerminalId] = useState<string | null>(null)
  const [ready, setReady] = useState(!transcript)
  useLayoutEffect(() => {
    if (!transcript) return
    const pty = (window as unknown as { api?: MockBridge }).api?.__mock?.pty
    setTerminalId(pty ? pty(TRANSCRIPTS[transcript]) : null)
    setReady(true)
  }, [transcript])
  if (!ready) return null
  const noop = () => {}
  return (
    <div className="flex h-screen w-full flex-col bg-bg">
      <CloudAgentPanel
        session={session}
        visible
        phase={phase}
        terminalId={terminalId}
        error={error}
        dirtyFiles={dirtyFiles}
        onOpenInBrowser={noop}
        onTeleport={noop}
        onReattach={noop}
        onSendFollowUp={async () => {}}
        onOpenLocally={noop}
      />
    </div>
  )
}

const meta: Meta<typeof Harness> = {
  title: 'Cloud/CloudAgentPanel',
  component: Harness,
  parameters: { layout: 'fullscreen' },
}
export default meta

type Story = StoryObj<typeof Harness>

/** Spawning the attach terminal. */
export const Attaching: Story = {
  args: { phase: 'attaching' },
}

/** Watching the cloud session through `claude --cloud <id>`. */
export const Attached: Story = {
  args: { phase: 'attached', transcript: 'attach' },
}

/** Attaching isn't enabled for the account: banner plus the follow-up box. */
export const AttachUnavailable: Story = {
  args: { phase: 'attach-unavailable', transcript: 'unavailable' },
}

/** The attach terminal exited; the cloud session keeps running. */
export const AttachEnded: Story = {
  args: { phase: 'attach-ended', transcript: 'attach' },
}

/** Teleport refused because the worktree has uncommitted changes. */
export const TeleportBlocked: Story = {
  args: {
    phase: 'teleport-blocked',
    transcript: 'attach',
    dirtyFiles: [
      'src/auth/session.ts',
      'src/auth/refresh.ts',
      'tests/auth.test.ts',
      'package.json',
      'package-lock.json',
      'README.md',
      '.env.example',
    ],
  },
}

/** Pulled down to the worktree — now the live local Claude session. */
export const Teleported: Story = {
  args: { session: TELEPORTED_SESSION, phase: 'teleported', transcript: 'teleport' },
}

/** The teleported (now local) Claude session exited. */
export const TeleportEnded: Story = {
  args: { session: TELEPORTED_SESSION, phase: 'teleport-ended', transcript: 'teleportEnded' },
}

/** Something failed (here: the attach). */
export const ErrorState: Story = {
  name: 'Error',
  args: {
    phase: 'error',
    error: "Couldn't attach to the cloud session: claude exited with code 1",
  },
}
