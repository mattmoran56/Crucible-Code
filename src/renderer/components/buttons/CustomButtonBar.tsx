import React from 'react'
import type { ButtonPlacement } from '../../../shared/types'
import { useButtonStore } from '../../stores/buttonStore'
import { useProjectStore } from '../../stores/projectStore'
import { CustomButtonRenderer, ButtonGroupRenderer } from './CustomButtonRenderer'

interface CustomButtonBarProps {
  placement: ButtonPlacement
}

export function CustomButtonBar({ placement }: CustomButtonBarProps) {
  const { activeProjectId } = useProjectStore()
  const { getGroupedButtons } = useButtonStore()
  const { ungrouped, groups } = getGroupedButtons(placement, activeProjectId)

  const hasContent = ungrouped.length > 0 || groups.length > 0
  if (!hasContent) return null

  const isVertical = placement === 'right-activity-bar'

  // Build a combined sorted list of ungrouped buttons and groups by order
  type Item =
    | { type: 'button'; button: typeof ungrouped[0]; order: number }
    | { type: 'group'; group: typeof groups[0]; order: number }

  const items: Item[] = [
    ...ungrouped.map((b) => ({ type: 'button' as const, button: b, order: b.order })),
    ...groups.map((g) => ({ type: 'group' as const, group: g, order: g.group.order })),
  ].sort((a, b) => a.order - b.order)

  if (isVertical) {
    return (
      <>
        {/* Divider */}
        <div
          className="bg-border"
          style={{ height: 1, width: 24, margin: '8px auto' }}
        />
        {items.map((item) =>
          item.type === 'button' ? (
            <CustomButtonRenderer
              key={item.button.id}
              button={item.button}
              orientation="vertical"
            />
          ) : (
            <ButtonGroupRenderer
              key={item.group.group.id}
              group={item.group.group}
              buttons={item.group.buttons}
              orientation="vertical"
            />
          )
        )}
      </>
    )
  }

  // Horizontal bar for session-toolbar and project-tabs
  if (placement === 'session-toolbar') {
    return (
      <div
        className="flex items-center gap-1 border-b border-border bg-bg-tertiary"
        style={{ padding: '2px 8px', minHeight: 32 }}
      >
        {items.map((item) =>
          item.type === 'button' ? (
            <CustomButtonRenderer
              key={item.button.id}
              button={item.button}
            />
          ) : (
            <ButtonGroupRenderer
              key={item.group.group.id}
              group={item.group.group}
              buttons={item.group.buttons}
            />
          )
        )}
      </div>
    )
  }

  // project-tabs: inline buttons
  return (
    <>
      {items.map((item) =>
        item.type === 'button' ? (
          <CustomButtonRenderer
            key={item.button.id}
            button={item.button}
          />
        ) : (
          <ButtonGroupRenderer
            key={item.group.group.id}
            group={item.group.group}
            buttons={item.group.buttons}
          />
        )
      )}
    </>
  )
}
