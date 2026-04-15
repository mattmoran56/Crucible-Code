import React, { useState } from 'react'
import type { CustomButton, CustomButtonGroup } from '../../../shared/types'
import { useButtonStore } from '../../stores/buttonStore'
import { renderButtonIcon } from './IconPicker'
import { DropdownMenu } from '../ui/DropdownMenu'
import { Dialog } from '../ui/Dialog'
import { Button } from '../ui/Button'
import { Tooltip } from '../ui/Tooltip'

const SpinnerIcon = ({ size = 14 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="animate-spin"
  >
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </svg>
)

interface CustomButtonRendererProps {
  button: CustomButton
  orientation?: 'horizontal' | 'vertical'
}

export function CustomButtonRenderer({
  button,
  orientation = 'horizontal',
}: CustomButtonRendererProps) {
  const { executeButton, cancelButton, viewButtonOutput, runningButtons } = useButtonStore()
  const [showConfirm, setShowConfirm] = useState(false)
  const runState = runningButtons[button.id]
  const isRunning = runState?.running ?? false

  const handleClick = () => {
    if (button.confirmMessage) {
      setShowConfirm(true)
    } else {
      executeButton(button.id)
    }
  }

  const handleConfirm = () => {
    setShowConfirm(false)
    executeButton(button.id)
  }

  const isVertical = orientation === 'vertical'
  const shortcutLabel = button.shortcut ? ` (${button.shortcut})` : ''

  const buttonClassName = `${
    isVertical ? 'w-8 h-8' : 'h-7 px-2 gap-1.5'
  } rounded flex items-center justify-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-text-muted hover:text-text hover:bg-bg-tertiary ${
    isRunning ? 'text-accent' : ''
  }`

  const buttonContent = (
    <>
      {isRunning ? (
        <SpinnerIcon size={isVertical ? 16 : 14} />
      ) : (
        renderButtonIcon(button.icon, isVertical ? 16 : 14)
      )}
      {!isVertical && (
        <span className="text-xs whitespace-nowrap">{button.label}</span>
      )}
    </>
  )

  // When running in background mode, show a dropdown with View Output / Cancel
  if (isRunning && button.executionMode === 'background') {
    const runningItems = [
      ...(runState?.terminalId
        ? [{
            label: 'View Output',
            onClick: () => viewButtonOutput(button.id),
          }]
        : []),
      {
        label: 'Cancel',
        variant: 'danger' as const,
        onClick: () => cancelButton(button.id),
      },
    ]

    return (
      <>
        <DropdownMenu items={runningItems}>
          <Tooltip content={`${button.label} (running) — click for options`} side={isVertical ? 'left' : 'bottom'}>
            <button
              aria-label={`${button.label} (running)`}
              className={buttonClassName}
              style={isVertical ? { marginTop: 4 } : undefined}
            >
              <SpinnerIcon size={isVertical ? 16 : 14} />
              {!isVertical && (
                <span className="text-xs whitespace-nowrap">{button.label}</span>
              )}
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="flex-shrink-0 opacity-60">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
          </Tooltip>
        </DropdownMenu>
      </>
    )
  }

  return (
    <>
      <Tooltip content={`${button.label}${shortcutLabel}`} side={isVertical ? 'left' : 'bottom'}>
        <button
          aria-label={button.label}
          onClick={handleClick}
          className={buttonClassName}
          style={isVertical ? { marginTop: 4 } : undefined}
        >
          {buttonContent}
        </button>
      </Tooltip>

      <Dialog
        open={showConfirm}
        title="Confirm Action"
        onClose={() => setShowConfirm(false)}
      >
        <p className="text-sm text-text" style={{ marginBottom: 16 }}>
          {button.confirmMessage}
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setShowConfirm(false)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleConfirm}>
            Confirm
          </Button>
        </div>
      </Dialog>
    </>
  )
}

interface ButtonGroupRendererProps {
  group: CustomButtonGroup
  buttons: CustomButton[]
  orientation?: 'horizontal' | 'vertical'
}

export function ButtonGroupRenderer({
  group,
  buttons,
  orientation = 'horizontal',
}: ButtonGroupRendererProps) {
  const { executeButton, runningButtons } = useButtonStore()
  const [confirmButton, setConfirmButton] = useState<CustomButton | null>(null)

  const anyRunning = buttons.some((b) => runningButtons[b.id]?.running)
  const isVertical = orientation === 'vertical'

  const items = buttons.map((b) => ({
    label: b.label,
    onClick: () => {
      if (b.confirmMessage) {
        setConfirmButton(b)
      } else {
        executeButton(b.id)
      }
    },
  }))

  const handleConfirm = () => {
    if (confirmButton) {
      executeButton(confirmButton.id)
      setConfirmButton(null)
    }
  }

  return (
    <>
      <DropdownMenu items={items}>
        <Tooltip content={group.label} side={isVertical ? 'left' : 'bottom'}>
          <button
            aria-label={group.label}
            className={`${
              isVertical ? 'w-8 h-8' : 'h-7 px-2 gap-1.5'
            } rounded flex items-center justify-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent text-text-muted hover:text-text hover:bg-bg-tertiary ${
              anyRunning ? 'text-accent' : ''
            }`}
            style={isVertical ? { marginTop: 4 } : undefined}
          >
            {anyRunning ? (
              <SpinnerIcon size={isVertical ? 16 : 14} />
            ) : (
              renderButtonIcon(group.icon, isVertical ? 16 : 14)
            )}
            {!isVertical && (
              <>
                <span className="text-xs whitespace-nowrap">{group.label}</span>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </>
            )}
          </button>
        </Tooltip>
      </DropdownMenu>

      <Dialog
        open={confirmButton !== null}
        title="Confirm Action"
        onClose={() => setConfirmButton(null)}
      >
        <p className="text-sm text-text" style={{ marginBottom: 16 }}>
          {confirmButton?.confirmMessage}
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmButton(null)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleConfirm}>
            Confirm
          </Button>
        </div>
      </Dialog>
    </>
  )
}
