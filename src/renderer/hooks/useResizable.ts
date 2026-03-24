import { useState, useCallback, useRef, useEffect } from 'react'

interface UseResizableOptions {
  direction: 'horizontal' | 'vertical'
  initialSize: number
  minSize?: number
  maxSize?: number
  inverted?: boolean
}

export function useResizable({
  direction,
  initialSize,
  minSize = 100,
  maxSize = 1200,
  inverted = false,
}: UseResizableOptions) {
  const [size, setSize] = useState(initialSize)
  const dragging = useRef(false)
  const startPos = useRef(0)
  const startSize = useRef(0)

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      dragging.current = true
      startPos.current = direction === 'horizontal' ? e.clientX : e.clientY
      startSize.current = size
      document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize'
      document.body.style.userSelect = 'none'
    },
    [direction, size]
  )

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return
      const current = direction === 'horizontal' ? e.clientX : e.clientY
      const delta = current - startPos.current
      const effectiveDelta = inverted ? -delta : delta
      const newSize = Math.min(maxSize, Math.max(minSize, startSize.current + effectiveDelta))
      setSize(newSize)
    }

    const onMouseUp = () => {
      if (!dragging.current) return
      dragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
  }, [direction, minSize, maxSize, inverted])

  return { size, onMouseDown }
}
