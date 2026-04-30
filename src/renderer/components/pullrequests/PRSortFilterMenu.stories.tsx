import type { Meta, StoryObj } from '@storybook/react'
import { useEffect, useRef } from 'react'
import { PRSortFilterMenu } from './PRSortFilterMenu'
import { resetStores, setupStoresForStory } from '../../stories/helpers/storeSetup'
import { usePRViewStore } from '../../stores/prViewStore'

const REPO_PATH = '/Users/dev/repos/CodeCrucible'

interface AutoOpenWrapperProps {
  prepare?: () => void
  /** When true, drill into the Assigned-to person picker after the menu opens. */
  drillIntoAssignee?: boolean
}

function AutoOpenWrapper({ prepare, drillIntoAssignee }: AutoOpenWrapperProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    resetStores()
    setupStoresForStory()
    prepare?.()

    const t = window.setTimeout(() => {
      const trigger = containerRef.current?.querySelector('button[aria-label="Sort & filter pull requests"]')
      ;(trigger as HTMLButtonElement | null)?.click()

      if (drillIntoAssignee) {
        window.setTimeout(() => {
          const buttons = Array.from(document.querySelectorAll('button')) as HTMLButtonElement[]
          const assigneeBtn = buttons.find((b) => b.textContent?.trim().startsWith('Assigned to'))
          assigneeBtn?.click()
        }, 80)
      }
    }, 30)
    return () => window.clearTimeout(t)
  }, [prepare, drillIntoAssignee])

  return (
    <div
      ref={containerRef}
      style={{
        width: 224,
        background: 'var(--color-bg-secondary)',
        padding: '8px 10px',
        borderBottom: '1px solid var(--color-border)',
        display: 'flex',
        justifyContent: 'flex-end',
      }}
    >
      <PRSortFilterMenu repoPath={REPO_PATH} />
    </div>
  )
}

const meta: Meta<typeof PRSortFilterMenu> = {
  title: 'PR/PRSortFilterMenu',
  component: PRSortFilterMenu,
  parameters: { layout: 'fullscreen' },
}
export default meta

type Story = StoryObj<typeof PRSortFilterMenu>

export const Open: Story = {
  render: () => <AutoOpenWrapper />,
}

export const FiltersActive: Story = {
  render: () => (
    <AutoOpenWrapper
      prepare={() => {
        usePRViewStore.setState({
          byRepo: {
            [REPO_PATH]: {
              sortBy: 'updated',
              status: { ready: true, draft: false },
              assignee: { kind: 'me' },
              author: { kind: 'anyone' },
              reviewer: { kind: 'anyone' },
              ci: { success: true, failure: true, pending: true, none: false },
              unseenOnly: false,
            },
          },
        })
      }}
    />
  ),
}

export const PersonPicker: Story = {
  render: () => <AutoOpenWrapper drillIntoAssignee />,
}
