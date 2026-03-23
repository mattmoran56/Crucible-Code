import React, { useEffect } from 'react'
import { ProjectTabs } from './components/layout/ProjectTabs'
import { SessionSidebar } from './components/layout/SessionSidebar'
import { SessionWorkspace } from './components/layout/SessionWorkspace'
import { ResizeHandle } from './components/ui/ResizeHandle'
import { useProjectStore } from './stores/projectStore'
import { useResizable } from './hooks/useResizable'

export default function App() {
  const { loadProjects } = useProjectStore()

  const sidebar = useResizable({ direction: 'horizontal', initialSize: 224, minSize: 140, maxSize: 400 })

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

        {/* Session workspace: toolbar + content (agent or git view) */}
        <SessionWorkspace />
      </div>
    </div>
  )
}
