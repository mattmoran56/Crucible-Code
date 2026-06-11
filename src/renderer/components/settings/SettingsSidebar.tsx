import React from 'react'

export type SettingsSection =
  | 'appearance'
  | 'cleanup-limits'
  | 'claude-accounts'
  | 'pr-list'
  | 'startup-prompts'
  | 'notion'
  | 'review-loop'
  | 'foundry'
  | 'project-defaults'
  | 'buttons'
  | 'about'

interface NavItem {
  id: SettingsSection
  label: string
  group: 'global' | 'project' | 'meta'
  requiresProjects?: boolean
}

const ITEMS: NavItem[] = [
  { id: 'appearance', label: 'Appearance', group: 'global' },
  { id: 'cleanup-limits', label: 'Cleanup & Limits', group: 'global' },
  { id: 'claude-accounts', label: 'Claude Accounts', group: 'global' },
  { id: 'buttons', label: 'Buttons', group: 'global' },
  { id: 'project-defaults', label: 'Project Defaults', group: 'project', requiresProjects: true },
  { id: 'pr-list', label: 'PR List Display', group: 'project' },
  { id: 'startup-prompts', label: 'Startup Prompts', group: 'project', requiresProjects: true },
  { id: 'notion', label: 'Notion', group: 'project', requiresProjects: true },
  { id: 'review-loop', label: 'Review Loop', group: 'project' },
  { id: 'foundry', label: 'Foundry', group: 'project', requiresProjects: true },
  { id: 'about', label: 'About', group: 'meta' },
]

interface Props {
  active: SettingsSection
  onChange: (section: SettingsSection) => void
  hasProjects: boolean
}

export function SettingsSidebar({ active, onChange, hasProjects }: Props) {
  const visible = ITEMS.filter((item) => !item.requiresProjects || hasProjects)
  const grouped: Record<NavItem['group'], NavItem[]> = {
    global: [],
    project: [],
    meta: [],
  }
  for (const item of visible) grouped[item.group].push(item)

  return (
    <aside
      className="h-full bg-bg-secondary border-r border-border flex flex-col shrink-0"
      style={{ width: 200 }}
    >
      <nav className="flex-1 overflow-y-auto" style={{ padding: '12px 8px' }}>
        <NavGroup label="General" items={grouped.global} active={active} onChange={onChange} />
        {grouped.project.length > 0 && (
          <NavGroup label="Per Project" items={grouped.project} active={active} onChange={onChange} />
        )}
        <NavGroup label="" items={grouped.meta} active={active} onChange={onChange} />
      </nav>
    </aside>
  )
}

function NavGroup({
  label,
  items,
  active,
  onChange,
}: {
  label: string
  items: NavItem[]
  active: SettingsSection
  onChange: (s: SettingsSection) => void
}) {
  if (items.length === 0) return null
  return (
    <div style={{ marginBottom: 16 }}>
      {label && (
        <p
          className="text-[10px] font-medium text-text-muted uppercase tracking-wide"
          style={{ padding: '4px 10px', marginBottom: 4 }}
        >
          {label}
        </p>
      )}
      <div className="flex flex-col gap-0.5">
        {items.map((item) => {
          const isActive = active === item.id
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onChange(item.id)}
              className={`text-left text-xs rounded-md transition-colors ${
                isActive
                  ? 'bg-bg-tertiary text-accent font-medium'
                  : 'text-text hover:bg-bg-tertiary'
              }`}
              style={{ padding: '6px 10px' }}
            >
              {item.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
