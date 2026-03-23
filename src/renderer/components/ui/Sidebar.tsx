import React from 'react'

// --- Sidebar ---

interface SidebarProps {
  children: React.ReactNode
  width?: string
  className?: string
}

export function Sidebar({ children, width = '14rem', className = '' }: SidebarProps) {
  return (
    <aside
      style={{ width }}
      className={`bg-bg-secondary border-r border-border flex flex-col ${className}`}
    >
      {children}
    </aside>
  )
}

// --- SidebarSection ---

interface SidebarSectionProps {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
}

export function SidebarSection({ title, action, children }: SidebarSectionProps) {
  return (
    <section className="flex flex-col flex-1 min-h-0">
      <div
        className="border-b border-border flex items-center justify-between"
        style={{ padding: '10px 12px' }}
      >
        <h2 className="text-xs font-medium text-text-muted uppercase tracking-wide">
          {title}
        </h2>
        {action}
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {children}
      </div>
    </section>
  )
}
