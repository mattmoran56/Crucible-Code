import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { DynamicTerminalPanel } from '../terminal/DynamicTerminalPanel'
import { EditorPanel } from './EditorPanel'
import { ResizeHandle } from '../ui'
import { useProjectStore } from '../../stores/projectStore'
import { useTerminalStore } from '../../stores/terminalStore'
import { useEditorStore } from '../../stores/editorStore'
import {
  useWorkspaceLayoutStore,
  isDynamicTab,
  type WorkspaceTab,
  type CoreTab,
} from '../../stores/workspaceLayoutStore'
import { ColumnPanel } from '../layout/WorkspaceColumn'

const EDITOR_CONTEXT_ID = 'code-editor'

export function EditorWorkspace() {
  const { projects, activeProjectId } = useProjectStore()
  const activeProject = projects.find((p) => p.id === activeProjectId)
  const repoPath = activeProject?.repoPath ?? ''

  const { columns, resetLayout, saveLayout, splitRight, canSplit, addDynamicTab, removeDynamicTab } =
    useWorkspaceLayoutStore()
  const { killDynamicTerminalAll } = useTerminalStore()
  const { loadBranch } = useEditorStore()

  // Initialize layout for editor mode
  const initializedRef = useRef(false)
  useEffect(() => {
    if (!initializedRef.current) {
      resetLayout(['code'], 'code', EDITOR_CONTEXT_ID)
      initializedRef.current = true
    }
    return () => {
      // Save layout when leaving editor mode
      saveLayout(EDITOR_CONTEXT_ID)
    }
  }, [])

  // Load branch info
  useEffect(() => {
    if (repoPath) {
      loadBranch(repoPath)
    }
  }, [repoPath, loadBranch])

  // Auto-save layout whenever columns change
  useEffect(() => {
    if (columns.length > 0) {
      saveLayout(EDITOR_CONTEXT_ID)
    }
  }, [columns])

  // Column resize
  const columnsRef = useRef<HTMLDivElement>(null)
  const resizeDrag = useRef<{
    leftId: string
    rightId: string
    startX: number
    leftStartWidth: number
    rightStartWidth: number
  } | null>(null)

  const onResizeStart = useCallback(
    (e: React.MouseEvent, leftId: string, rightId: string) => {
      e.preventDefault()
      const container = columnsRef.current
      if (!container) return
      const leftEl = container.querySelector(`[data-column-id="${leftId}"]`) as HTMLElement
      const rightEl = container.querySelector(`[data-column-id="${rightId}"]`) as HTMLElement
      if (!leftEl || !rightEl) return

      resizeDrag.current = {
        leftId,
        rightId,
        startX: e.clientX,
        leftStartWidth: leftEl.offsetWidth,
        rightStartWidth: rightEl.offsetWidth,
      }
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    },
    []
  )

  useEffect(() => {
    const { setColumnFlex } = useWorkspaceLayoutStore.getState()
    const onMouseMove = (e: MouseEvent) => {
      if (!resizeDrag.current) return
      const { leftId, rightId, startX, leftStartWidth, rightStartWidth } = resizeDrag.current
      const delta = e.clientX - startX
      const minWidth = 200
      const totalWidth = leftStartWidth + rightStartWidth

      let newLeft = leftStartWidth + delta
      let newRight = rightStartWidth - delta
      if (newLeft < minWidth) {
        newLeft = minWidth
        newRight = totalWidth - minWidth
      }
      if (newRight < minWidth) {
        newRight = minWidth
        newLeft = totalWidth - minWidth
      }

      setColumnFlex(leftId, newLeft)
      setColumnFlex(rightId, newRight)
    }

    const onMouseUp = () => {
      if (!resizeDrag.current) return
      resizeDrag.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

  // Drag state
  const [dragOverInfo, setDragOverInfo] = useState<{
    columnId: string
    index: number
  } | null>(null)

  const splitEnabled = canSplit()

  const handleAddDynamicTab = useCallback(
    (columnId: string, type: 'agent' | 'terminal') => {
      addDynamicTab(columnId, type)
    },
    [addDynamicTab]
  )

  const handleCloseDynamicTab = useCallback(
    (tab: WorkspaceTab) => {
      killDynamicTerminalAll(tab)
      removeDynamicTab(tab)
    },
    [killDynamicTerminalAll, removeDynamicTab]
  )

  // Core panel portal target for the 'code' tab
  const codePanelTarget = useRef<HTMLDivElement | null>(null)
  if (!codePanelTarget.current) {
    const div = document.createElement('div')
    div.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;min-height:0'
    div.dataset.panelTarget = 'code'
    codePanelTarget.current = div
  }

  // Dynamic portal targets
  const dynamicPanelTargets = useRef<Map<string, HTMLDivElement>>(new Map())

  const allDynamicTabs = useMemo(() => {
    const tabs = new Set<string>()
    for (const col of columns) {
      for (const tab of col.tabs) {
        if (isDynamicTab(tab)) tabs.add(tab)
      }
    }
    return tabs
  }, [columns])

  useEffect(() => {
    const targets = dynamicPanelTargets.current
    for (const tab of allDynamicTabs) {
      if (!targets.has(tab)) {
        const div = document.createElement('div')
        div.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;min-height:0'
        div.dataset.panelTarget = tab
        targets.set(tab, div)
      }
    }
    for (const [tab, div] of targets) {
      if (!allDynamicTabs.has(tab)) {
        div.remove()
        targets.delete(tab)
      }
    }
  }, [allDynamicTabs])

  // Move portal targets into columns
  useEffect(() => {
    const codeTarget = codePanelTarget.current!
    const dynTargets = dynamicPanelTargets.current
    const container = columnsRef.current
    if (!container) return

    // Hide code target first
    codeTarget.style.visibility = 'hidden'
    codeTarget.style.pointerEvents = 'none'
    codeTarget.style.zIndex = '0'

    for (const [, div] of dynTargets) {
      div.style.visibility = 'hidden'
      div.style.pointerEvents = 'none'
      div.style.zIndex = '0'
    }

    for (const col of columns) {
      const contentEl = container.querySelector(
        `[data-column-id="${col.id}"] [data-column-content]`
      ) as HTMLElement
      if (!contentEl) continue

      for (const tab of col.tabs) {
        let target: HTMLDivElement | undefined
        if (tab === 'code') {
          target = codeTarget
        } else if (isDynamicTab(tab)) {
          target = dynTargets.get(tab)
        }
        if (!target) continue
        const isActive = tab === col.activeTab
        target.style.visibility = isActive ? 'visible' : 'hidden'
        target.style.pointerEvents = isActive ? 'auto' : 'none'
        target.style.zIndex = isActive ? '1' : '0'
        contentEl.appendChild(target)
      }
    }
  }, [columns])

  if (!repoPath) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted text-sm">
        No project selected
      </div>
    )
  }

  if (columns.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted text-sm">
        Loading editor...
      </div>
    )
  }

  return (
    <>
      <div className="flex-1 flex min-h-0" ref={columnsRef}>
        {columns.map((col, i) => (
          <React.Fragment key={col.id}>
            {i > 0 && (
              <ResizeHandle
                direction="horizontal"
                onMouseDown={(e) => onResizeStart(e, columns[i - 1].id, col.id)}
              />
            )}
            <ColumnPanel
              column={col}
              canClose={columns.length > 1}
              canSplit={splitEnabled}
              onSplit={splitRight}
              dragOverInfo={dragOverInfo}
              setDragOverInfo={setDragOverInfo}
              onAddDynamicTab={handleAddDynamicTab}
              onCloseDynamicTab={handleCloseDynamicTab}
            />
          </React.Fragment>
        ))}
      </div>
      {/* Code panel portal */}
      {createPortal(<EditorPanel repoPath={repoPath} />, codePanelTarget.current)}
      {/* Dynamic terminal panels */}
      {[...allDynamicTabs].map((tab) => {
        const target = dynamicPanelTargets.current.get(tab)
        if (!target) return null
        const isVisible = columns.some((c) => c.activeTab === tab)
        return createPortal(
          <DynamicTerminalPanel
            key={tab}
            tabId={tab as WorkspaceTab}
            visible={isVisible}
            overrideCwd={repoPath}
            overrideSessionId="__code-editor__"
          />,
          target
        )
      })}
    </>
  )
}
