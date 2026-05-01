import { useEffect } from 'react'
import type { Meta, StoryObj } from '@storybook/react'
import App from '../App'
import { setupStoresForStory, resetStores } from './helpers/storeSetup'
import { useNotificationStore } from '../stores/notificationStore'
import type { SessionStatus } from '../../shared/types'

const meta: Meta<typeof App> = {
  title: 'App/Full Layout',
  component: App,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => {
      resetStores()
      return (
        <div style={{ height: '100vh', width: '100vw' }}>
          <Story />
        </div>
      )
    },
  ],
}
export default meta

type Story = StoryObj<typeof App>

export const Default: Story = {
  decorators: [
    (Story) => {
      setupStoresForStory()
      return <Story />
    },
  ],
}

export const GitView: Story = {
  decorators: [
    (Story) => {
      setupStoresForStory({ activeWorkspaceTab: 'git' })
      return <Story />
    },
  ],
}

export const PRReview: Story = {
  decorators: [
    (Story) => {
      setupStoresForStory({ activePRNumber: 42, activeWorkspaceTab: 'pr' })
      return <Story />
    },
  ],
}

export const EditorView: Story = {
  decorators: [
    (Story) => {
      setupStoresForStory({ editorMode: true })
      return <Story />
    },
  ],
}

/** Auto-clicks the Code-nav branch picker after mount so the dropdown is open. */
function OpenBranchPickerAfterMount() {
  useEffect(() => {
    const id = setTimeout(() => {
      const trigger = document.querySelector<HTMLButtonElement>(
        '[aria-haspopup="listbox"][aria-expanded]'
      )
      trigger?.click()
    }, 200)
    return () => clearTimeout(id)
  }, [])
  return null
}

export const EditorBranchPicker: Story = {
  decorators: [
    (Story) => {
      setupStoresForStory({ editorMode: true })
      return (
        <>
          <OpenBranchPickerAfterMount />
          <Story />
        </>
      )
    },
  ],
}

export const EditorWorktreeView: Story = {
  decorators: [
    (Story) => {
      setupStoresForStory({
        editorMode: true,
        editorActiveTab: 'git',
      })
      return <Story />
    },
  ],
}

export const Settings: Story = {
  decorators: [
    (Story) => {
      setupStoresForStory({ settingsOpen: true })
      return <Story />
    },
  ],
}

export const CustomButtons: Story = {
  decorators: [
    (Story) => {
      setupStoresForStory()
      return <Story />
    },
  ],
}

export const OpenedAsMainBranch: Story = {
  decorators: [
    (Story) => {
      setupStoresForStory({ openedAsMainBranch: 'sess-1', didStash: true })
      return <Story />
    },
  ],
}

export const ButtonSettings: Story = {
  decorators: [
    (Story) => {
      setupStoresForStory({ settingsOpen: true })
      return <Story />
    },
  ],
}

// Stories demonstrating per-agent attention indicators added in
// "Route notifications to specific agent tabs and treat Code/PRs as session contexts"

export const CodeAttention: Story = {
  decorators: [
    (Story) => {
      setupStoresForStory({
        editorMode: true,
        contextStatuses: {
          'code-editor:proj-1': { 'agent:1': 'attention' },
        },
      })
      return <Story />
    },
  ],
}

export const PRAttention: Story = {
  decorators: [
    (Story) => {
      setupStoresForStory({
        sessionStatuses: { 'sess-1': 'running', 'sess-2': 'attention' },
        contextStatuses: {
          '__pr__:42': { 'agent:1': 'attention' },
        },
      })
      return <Story />
    },
  ],
}

/**
 * Re-applies an attention status for the active session AFTER App's auto-clear
 * effect has had a chance to run, so the screenshot shows the agent tab with
 * its yellow dot rather than the cleared 'running' state.
 */
function ApplyAttentionAfterMount({ contextId, tabId, status }: { contextId: string; tabId: string; status: SessionStatus }) {
  useEffect(() => {
    const id = setTimeout(() => {
      useNotificationStore.setState((state) => {
        const next = new Map<string, Map<string, SessionStatus>>()
        for (const [k, v] of state.contextStatuses) next.set(k, new Map(v))
        const tabs = next.get(contextId) ?? new Map<string, SessionStatus>()
        tabs.set(tabId, status)
        next.set(contextId, tabs)
        return { contextStatuses: next }
      })
    }, 150)
    return () => clearTimeout(id)
  }, [contextId, tabId, status])
  return null
}

export const TabAttention: Story = {
  decorators: [
    (Story) => {
      setupStoresForStory({})
      return (
        <>
          <ApplyAttentionAfterMount contextId="sess-1" tabId="agent" status="attention" />
          <Story />
        </>
      )
    },
  ],
}

/** Dispatches the in-app "create-session" event so the New Session dialog opens. */
function OpenNewSessionDialogAfterMount() {
  useEffect(() => {
    const id = setTimeout(() => {
      window.dispatchEvent(new Event('app:create-session'))
    }, 200)
    return () => clearTimeout(id)
  }, [])
  return null
}

/** Opens the dialog and clicks the chip with the given label so the input field appears. */
function PickStartupPromptAfterMount({ label }: { label: string }) {
  useEffect(() => {
    const id = setTimeout(() => {
      window.dispatchEvent(new Event('app:create-session'))
      setTimeout(() => {
        const dialog = document.querySelector<HTMLElement>('[role="dialog"]')
        if (!dialog) return
        const buttons = Array.from(dialog.querySelectorAll<HTMLButtonElement>('button'))
        const chip = buttons.find((b) => b.textContent?.trim() === label)
        chip?.click()
      }, 250)
    }, 200)
    return () => clearTimeout(id)
  }, [label])
  return null
}

export const NewSessionDialog: Story = {
  decorators: [
    (Story) => {
      setupStoresForStory()
      return (
        <>
          <OpenNewSessionDialogAfterMount />
          <Story />
        </>
      )
    },
  ],
}

export const NewSessionDialogWithInput: Story = {
  decorators: [
    (Story) => {
      setupStoresForStory()
      return (
        <>
          <PickStartupPromptAfterMount label="Notion Ticket" />
          <Story />
        </>
      )
    },
  ],
}

export const StartupPromptSettings: Story = {
  decorators: [
    (Story) => {
      setupStoresForStory({ settingsOpen: true })
      return <Story />
    },
  ],
}

/** Opens settings and clicks "+ Add prompt" on the first project so the editor dialog is shown. */
function OpenStartupPromptEditorAfterMount() {
  useEffect(() => {
    const id = setTimeout(() => {
      const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
      const addBtn = buttons.find((b) => b.textContent?.trim() === '+ Add prompt')
      addBtn?.click()
    }, 600)
    return () => clearTimeout(id)
  }, [])
  return null
}

export const StartupPromptEditor: Story = {
  decorators: [
    (Story) => {
      setupStoresForStory({ settingsOpen: true })
      return (
        <>
          <OpenStartupPromptEditorAfterMount />
          <Story />
        </>
      )
    },
  ],
}
