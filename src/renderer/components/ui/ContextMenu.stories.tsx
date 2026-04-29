import type { Meta, StoryObj } from '@storybook/react'
import { useContextMenu } from './ContextMenu'

function Demo({ items }: { items: { label: string; variant?: 'default' | 'danger'; separatorAfter?: boolean }[] }) {
  const { onContextMenu, menu } = useContextMenu()
  return (
    <div
      onContextMenu={(e) =>
        onContextMenu(
          e,
          items.map((it) => ({
            ...it,
            onClick: () => alert(`Clicked: ${it.label}`),
          }))
        )
      }
      style={{
        width: 320,
        height: 200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        userSelect: 'none',
      }}
      className="bg-bg-secondary border border-border rounded text-text-muted text-xs"
    >
      Right-click anywhere
      {menu}
    </div>
  )
}

const meta: Meta<typeof Demo> = {
  title: 'UI/ContextMenu',
  component: Demo,
  parameters: { layout: 'centered' },
}
export default meta

type Story = StoryObj<typeof Demo>

export const FileExplorer: Story = {
  args: {
    items: [
      { label: 'Open' },
      { label: 'Copy relative path' },
      { label: 'Copy absolute path', separatorAfter: true },
      { label: 'Reveal in Finder' },
      { label: 'Delete file', variant: 'danger' },
    ],
  },
}

export const ChangedFiles: Story = {
  args: {
    items: [
      { label: 'Open' },
      { label: 'Reveal in Finder' },
      { label: 'Copy path', separatorAfter: true },
      { label: 'Stage file' },
      { label: 'Unstage file' },
      { label: 'Stash this file', separatorAfter: true },
      { label: 'Discard changes', variant: 'danger' },
    ],
  },
}
