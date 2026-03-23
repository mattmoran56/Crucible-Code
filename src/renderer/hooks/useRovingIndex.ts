import { useState, useRef, useCallback } from 'react'

interface UseRovingIndexOptions {
  itemCount: number
  orientation: 'horizontal' | 'vertical'
  loop?: boolean
  onSelect?: (index: number) => void
}

export function useRovingIndex({
  itemCount,
  orientation,
  loop = true,
  onSelect,
}: UseRovingIndexOptions) {
  const [activeIndex, setActiveIndex] = useState(0)
  const refs = useRef<(HTMLElement | null)[]>([])

  const moveTo = useCallback(
    (index: number) => {
      setActiveIndex(index)
      refs.current[index]?.focus()
      refs.current[index]?.scrollIntoView({ block: 'nearest' })
    },
    []
  )

  const getItemProps = useCallback(
    (index: number) => {
      const prevKey = orientation === 'horizontal' ? 'ArrowLeft' : 'ArrowUp'
      const nextKey = orientation === 'horizontal' ? 'ArrowRight' : 'ArrowDown'

      return {
        tabIndex: index === activeIndex ? 0 : -1,
        ref: (el: HTMLElement | null) => {
          refs.current[index] = el
        },
        onFocus: () => setActiveIndex(index),
        onKeyDown: (e: React.KeyboardEvent) => {
          let handled = true

          if (e.key === nextKey) {
            const next = activeIndex + 1
            if (next < itemCount) moveTo(next)
            else if (loop) moveTo(0)
          } else if (e.key === prevKey) {
            const prev = activeIndex - 1
            if (prev >= 0) moveTo(prev)
            else if (loop) moveTo(itemCount - 1)
          } else if (e.key === 'Home') {
            moveTo(0)
          } else if (e.key === 'End') {
            moveTo(itemCount - 1)
          } else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onSelect?.(index)
          } else {
            handled = false
          }

          if (handled) e.preventDefault()
        },
      }
    },
    [activeIndex, itemCount, orientation, loop, onSelect, moveTo]
  )

  return { activeIndex, setActiveIndex, getItemProps }
}
