import React, { useEffect, useLayoutEffect, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import type { Session } from '../../../shared/types'
import { CloudAgentPanel, type BranchNotice, type CloudAgentPhase } from './CloudAgentPanel'

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
  branchNotice?: BranchNotice | null
  /**
   * Storybook has no Electron <webview>: by default the page is stubbed. Set
   * to render the (inert) <webview> element so the loading / failed overlays
   * show; `failLoad` then fires a did-fail-load at it.
   */
  embedWebview?: boolean
  failLoad?: boolean
}

/** Spawns a fake PTY for the transcript (if any), then mounts the panel. */
function Harness({ session = SESSION, phase, transcript, error, dirtyFiles, branchNotice, embedWebview, failLoad }: StoryProps) {
  const [terminalId, setTerminalId] = useState<string | null>(null)
  const [ready, setReady] = useState(!transcript)
  useLayoutEffect(() => {
    if (!transcript) return
    const pty = (window as unknown as { api?: MockBridge }).api?.__mock?.pty
    setTerminalId(pty ? pty(TRANSCRIPTS[transcript]) : null)
    setReady(true)
  }, [transcript])
  useEffect(() => {
    if (!failLoad) return
    const view = document.querySelector('[data-testid="cloud-webview"]')
    view?.dispatchEvent(
      Object.assign(new Event('did-fail-load'), { errorCode: -106, errorDescription: 'ERR_INTERNET_DISCONNECTED', isMainFrame: true })
    )
  }, [failLoad, ready])
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
        onDismissError={noop}
        onOpenLocally={noop}
        branchNotice={branchNotice}
        onCleanupBranch={async (b) => `Deleted ${b} locally and on origin.`}
        embedWebview={embedWebview}
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

/** The claude.ai/code session page embedded in the tab (stubbed in Storybook). */
export const Embedded: Story = {
  args: { phase: 'web' },
}

/** The page is still loading. */
export const PageLoading: Story = {
  args: { phase: 'web', embedWebview: true },
}

/** The page failed to load: Retry or Open in browser. */
export const PageLoadFailed: Story = {
  args: { phase: 'web', embedWebview: true, failLoad: true },
}

/** Teleport refused because the worktree has uncommitted changes. */
export const TeleportBlocked: Story = {
  args: {
    phase: 'teleport-blocked',
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

/** The teleport checked out another branch: the session follows it; cleanup is offered. */
export const TeleportBranchChanged: Story = {
  args: {
    session: { ...TELEPORTED_SESSION, branchName: 'claude/fix-auth-refresh-x7Qm' },
    phase: 'teleported',
    transcript: 'teleport',
    branchNotice: { expected: 'session/fix-auth-refresh', actual: 'claude/fix-auth-refresh-x7Qm' },
  },
}

/** Something failed (here: the teleport). */
export const ErrorState: Story = {
  name: 'Error',
  args: {
    phase: 'error',
    error: 'Teleport failed: claude exited with code 1',
  },
}
