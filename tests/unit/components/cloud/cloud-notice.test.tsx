import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CloudAgentPanel } from '../../../../src/renderer/components/cloud/CloudAgentPanel'

const session = {
  id: 's1',
  name: 'Cloud',
  branchName: 'feat/x',
  worktreePath: '/wt',
  projectId: 'p1',
  createdAt: 'now',
  location: 'cloud',
  cloud: { sessionId: 'session_01AbCdEfGh', url: 'https://claude.ai/code/session_01AbCdEfGh' },
} as any

const props = {
  session,
  visible: true,
  phase: 'web' as const,
  terminalId: null,
  onOpenInBrowser: () => {},
  onTeleport: () => {},
  onDismissError: () => {},
  embedWebview: false,
}

describe('CloudAgentPanel relayed notification', () => {
  it('shows what claude.ai said and can be dismissed', async () => {
    const onDismissNotice = vi.fn()
    render(
      <CloudAgentPanel
        {...props}
        notice={{ title: 'Claude needs your input', body: 'Approve running npm test?', kind: 'attention', at: 0 }}
        onDismissNotice={onDismissNotice}
      />,
    )
    const banner = screen.getByTestId('cloud-notice')
    expect(banner).toHaveTextContent('Claude needs your input')
    expect(banner).toHaveTextContent('Approve running npm test?')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(onDismissNotice).toHaveBeenCalled()
  })

  it('shows nothing without a notice', () => {
    render(<CloudAgentPanel {...props} />)
    expect(screen.queryByTestId('cloud-notice')).toBeNull()
  })
})
