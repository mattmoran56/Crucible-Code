import React, { Children, cloneElement, isValidElement } from 'react'
import { useRovingIndex } from '../../hooks/useRovingIndex'

// --- ListBox ---

interface ListBoxProps {
  children: React.ReactNode
  label: string
  className?: string
  onSelect?: (index: number) => void
}

export function ListBox({ children, label, className = '', onSelect }: ListBoxProps) {
  const items = Children.toArray(children).filter(isValidElement)
  const { getItemProps } = useRovingIndex({
    itemCount: items.length,
    orientation: 'vertical',
    onSelect,
  })

  return (
    <div role="listbox" aria-label={label} aria-orientation="vertical" className={className}>
      {items.map((child, index) => {
        if (!isValidElement(child)) return child
        const rovingProps = getItemProps(index)
        return cloneElement(child as React.ReactElement<any>, {
          role: 'option',
          tabIndex: rovingProps.tabIndex,
          onKeyDown: rovingProps.onKeyDown,
          onFocus: rovingProps.onFocus,
          ref: rovingProps.ref,
        })
      })}
    </div>
  )
}

// --- ListItem ---

interface ListItemProps extends React.HTMLAttributes<HTMLDivElement> {
  selected?: boolean
  children: React.ReactNode
}

export const ListItem = React.forwardRef<HTMLDivElement, ListItemProps>(
  function ListItem({ selected = false, children, className = '', ...rest }, ref) {
    return (
      <div
        ref={ref}
        aria-selected={selected}
        className={`cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset ${
          selected ? 'bg-accent/10 text-accent' : 'hover:bg-bg-tertiary'
        } ${className}`}
        {...rest}
      >
        {children}
      </div>
    )
  }
)
