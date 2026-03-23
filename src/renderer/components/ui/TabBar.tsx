import React, { Children, cloneElement, isValidElement } from 'react'
import { useRovingIndex } from '../../hooks/useRovingIndex'

// --- TabBar ---

interface TabBarProps {
  children: React.ReactNode
  label: string
  className?: string
}

export function TabBar({ children, label, className = '' }: TabBarProps) {
  const items = Children.toArray(children).filter(isValidElement)

  // Find the initially active tab
  const initialActive = items.findIndex(
    (child) => isValidElement(child) && (child.props as any).active
  )

  const { getItemProps } = useRovingIndex({
    itemCount: items.length,
    orientation: 'horizontal',
    onSelect: (index) => {
      const child = items[index]
      if (isValidElement(child)) {
        ;(child.props as any).onClick?.()
      }
    },
  })

  // Set the initial active index
  React.useEffect(() => {
    if (initialActive >= 0) {
      // Handled by the roving index defaulting
    }
  }, [initialActive])

  return (
    <div
      role="tablist"
      aria-label={label}
      aria-orientation="horizontal"
      className={`flex items-center h-full ${className}`}
    >
      {items.map((child, index) => {
        if (!isValidElement(child)) return child
        const rovingProps = getItemProps(index)
        return cloneElement(child as React.ReactElement<any>, {
          role: 'tab',
          'aria-selected': (child.props as any).active || false,
          tabIndex: rovingProps.tabIndex,
          onKeyDown: rovingProps.onKeyDown,
          onFocus: rovingProps.onFocus,
          ref: rovingProps.ref,
        })
      })}
    </div>
  )
}

// --- Tab ---

interface TabProps extends React.HTMLAttributes<HTMLButtonElement> {
  active?: boolean
  children: React.ReactNode
}

export const Tab = React.forwardRef<HTMLButtonElement, TabProps>(
  function Tab({ active = false, children, className = '', onClick, ...rest }, ref) {
    return (
      <button
        ref={ref}
        onClick={onClick}
        className={`relative flex items-center justify-center h-full text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset ${
          active
            ? 'bg-bg text-text'
            : 'text-text-muted hover:text-text hover:bg-bg-secondary'
        } ${className}`}
        {...rest}
      >
        {children}
        {active && (
          <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-accent" />
        )}
      </button>
    )
  }
)
