import { useRef, useEffect } from 'react'

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function useFocusTrap(active: boolean) {
  const containerRef = useRef<HTMLDivElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!active || !containerRef.current) return

    previousFocus.current = document.activeElement as HTMLElement

    const container = containerRef.current
    const focusables = () =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))

    // Focus first focusable element
    const first = focusables()[0]
    if (first) first.focus()
    else container.focus()

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        const items = focusables()
        if (items.length === 0) {
          e.preventDefault()
          return
        }

        const firstItem = items[0]
        const lastItem = items[items.length - 1]

        if (e.shiftKey) {
          if (document.activeElement === firstItem) {
            e.preventDefault()
            lastItem.focus()
          }
        } else {
          if (document.activeElement === lastItem) {
            e.preventDefault()
            firstItem.focus()
          }
        }
      }
    }

    container.addEventListener('keydown', handleKeyDown)

    return () => {
      container.removeEventListener('keydown', handleKeyDown)
      if (previousFocus.current && previousFocus.current.focus) {
        previousFocus.current.focus()
      }
    }
  }, [active])

  return containerRef
}
