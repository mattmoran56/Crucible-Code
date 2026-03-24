import React from 'react'

// --- Sidebar ---

interface SidebarProps {
  children: React.ReactNode
  width?: string
  className?: string
}

export function Sidebar({ children, className = '' }: SidebarProps) {
  return (
    <aside
      className={`h-full bg-bg-secondary flex flex-col ${className}`}
    >
      {children}
    </aside>
  )
}

// --- Chevron icon ---

function ChevronIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`transition-transform ${collapsed ? '-rotate-90' : ''}`}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

// --- SidebarSection ---

interface SidebarSectionProps {
  title: string
  action?: React.ReactNode
  badge?: number
  collapsible?: boolean
  collapsed?: boolean
  onToggle?: () => void
  children: React.ReactNode
}

export function SidebarSection({
  title,
  action,
  badge,
  collapsible,
  collapsed,
  onToggle,
  children,
}: SidebarSectionProps) {
  return (
    <section className="flex flex-col flex-1 min-h-0">
      <div
        className={`border-b border-border flex items-center justify-between ${collapsible ? 'cursor-pointer select-none hover:bg-bg-tertiary' : ''}`}
        style={{ padding: '10px 12px' }}
        onClick={collapsible ? onToggle : undefined}
      >
        <div className="flex items-center gap-1.5">
          {collapsible && <ChevronIcon collapsed={!!collapsed} />}
          <h2 className="text-xs font-medium text-text-muted uppercase tracking-wide">
            {title}
          </h2>
          {badge != null && badge > 0 && (
            <span className="bg-accent text-bg text-[9px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">
              {badge}
            </span>
          )}
        </div>
        {action && <div onClick={(e) => e.stopPropagation()}>{action}</div>}
      </div>
      {!collapsed && (
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
          {children}
        </div>
      )}
    </section>
  )
}
