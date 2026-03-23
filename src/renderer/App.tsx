import React, { useEffect } from 'react'
import { ProjectTabs } from './components/layout/ProjectTabs'
import { SessionSidebar } from './components/layout/SessionSidebar'
import { GitPanel } from './components/git/GitPanel'
import { TerminalPanel } from './components/terminal/TerminalPanel'
import { ResizeHandle } from './components/ui/ResizeHandle'
import { useProjectStore } from './stores/projectStore'
import { useResizable } from './hooks/useResizable'

export default function App() {
  const { loadProjects } = useProjectStore()

  const sidebar = useResizable({ direction: 'horizontal', initialSize: 224, minSize: 140, maxSize: 400 })
  const terminal = useResizable({ direction: 'vertical', initialSize: 288, minSize: 100, maxSize: 600 })

  useEffect(() => {
    loadProjects()
  }, [loadProjects])

  return (
    <div className="h-full flex flex-col">
      <ProjectTabs />

      <div className="flex-1 flex min-h-0">
        {/* Session sidebar — resizable width */}
        <div style={{ width: sidebar.size }} className="flex-shrink-0">
          <SessionSidebar />
        </div>
        <ResizeHandle direction="horizontal" onMouseDown={sidebar.onMouseDown} />

        {/* Work area: git panel (top) + terminal (bottom) */}
        <div className="flex-1 flex flex-col min-h-0">
          {/* Git panel — takes remaining space */}
          <div className="flex-1 flex min-h-0 border-b border-border">
            <GitPanel />
          </div>

          <ResizeHandle direction="vertical" onMouseDown={terminal.onMouseDown} />

          {/* Terminal — resizable height */}
          <div style={{ height: terminal.size }} className="flex-shrink-0 flex flex-col min-h-0">
            <TerminalPanel />
          </div>
        </div>
      </div>
    </div>
  )
}
