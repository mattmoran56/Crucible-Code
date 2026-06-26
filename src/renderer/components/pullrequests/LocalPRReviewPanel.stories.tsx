import type { Meta, StoryObj } from '@storybook/react'
import { LocalPRReviewPanel } from './LocalPRReviewPanel'
import type { LocalPR } from '../../../shared/types'

const body = `## Summary

Lays the database + Go model foundation for simulation versioning. Two new
tables (\`job_drop_versions\`, \`job_drop_revisions\`) added as additive DDL.

## Review checklist

| Question | Status |
|----------|--------|
| Migrations safe on prod? | ✅ |
| Affects emails/notifications? | ➖ |
| Changes permissions? | ➖ |
`

const localPR: LocalPR = {
  id: 'lpr-1',
  localNumber: 1,
  projectId: 'p1',
  sessionId: 's1',
  worktreePath: '/wt',
  title: 'Feature: new job_drop_versions + Go models',
  body,
  branch: 'session/versioning-tables-models',
  baseBranch: 'project/simulation-versioning',
  status: 'local',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  log: [],
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ width: 720, height: 600, display: 'flex', background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
      {children}
    </div>
  )
}

const meta: Meta<typeof LocalPRReviewPanel> = {
  title: 'PR/LocalPRReviewPanel',
  component: LocalPRReviewPanel,
  parameters: { layout: 'centered' },
}
export default meta

type Story = StoryObj<typeof LocalPRReviewPanel>

export const Default: Story = {
  render: () => (
    <Frame>
      <LocalPRReviewPanel localPR={localPR} />
    </Frame>
  ),
}

export const ReadyWithFindings: Story = {
  render: () => (
    <Frame>
      <LocalPRReviewPanel
        localPR={{
          ...localPR,
          readyForReview: true,
          reviewFindings: '### Review loop\n\n- Skipped: 1 nit in `models.go` (style only)\n- Deferred: broader refactor of the repository layer',
        }}
      />
    </Frame>
  ),
}
