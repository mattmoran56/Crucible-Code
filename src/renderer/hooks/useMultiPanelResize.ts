import { useState, useCallback, useRef, useEffect } from 'react'

interface UseMultiPanelResizeOptions {
  containerSize: number
  minSizes: number[]
  initialRatios: number[]
  collapsedPanels: boolean[]
  collapsedSize: number
}

export function useMultiPanelResize({
  containerSize,
  minSizes,
  initialRatios,
  collapsedPanels,
  collapsedSize,
}: UseMultiPanelResizeOptions) {
  const panelCount = minSizes.length
  const [sizes, setSizes] = useState<number[]>(() =>
    initialRatios.map((r) => Math.round(containerSize * r))
  )
  const dragging = useRef<number | null>(null)
  const startY = useRef(0)
  const startSizes = useRef<number[]>([])

  // Recalculate sizes when containerSize or collapsed state changes
  useEffect(() => {
    if (containerSize <= 0) return

    setSizes((prev) => {
      const collapsedTotal = collapsedPanels.reduce(
        (sum, c) => sum + (c ? collapsedSize : 0),
        0
      )
      const availableSpace = containerSize - collapsedTotal

      // Get the previous expanded sizes for ratio calculation
      const expandedIndices = collapsedPanels
        .map((c, i) => (c ? -1 : i))
        .filter((i) => i >= 0)
      const prevExpandedTotal = expandedIndices.reduce(
        (sum, i) => sum + prev[i],
        0
      )

      return prev.map((prevSize, i) => {
        if (collapsedPanels[i]) return collapsedSize
        if (prevExpandedTotal <= 0) {
          return Math.round(availableSpace / expandedIndices.length)
        }
        const ratio = prevSize / prevExpandedTotal
        return Math.max(minSizes[i], Math.round(availableSpace * ratio))
      })
    })
  }, [containerSize, collapsedPanels, collapsedSize, minSizes, panelCount])

  const onHandleMouseDown = useCallback(
    (handleIndex: number) => (e: React.MouseEvent) => {
      e.preventDefault()
      dragging.current = handleIndex
      startY.current = e.clientY
      startSizes.current = [...sizes]
      document.body.style.cursor = 'row-resize'
      document.body.style.userSelect = 'none'
    },
    [sizes]
  )

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (dragging.current === null) return
      const handleIdx = dragging.current
      const delta = e.clientY - startY.current

      // Find the actual panels above and below this handle
      // (skip collapsed panels)
      let aboveIdx = handleIdx
      let belowIdx = handleIdx + 1

      // If either panel is collapsed, don't allow resize
      if (collapsedPanels[aboveIdx] || collapsedPanels[belowIdx]) return

      const aboveSize = startSizes.current[aboveIdx] + delta
      const belowSize = startSizes.current[belowIdx] - delta

      const aboveClamped = Math.max(minSizes[aboveIdx], aboveSize)
      const belowClamped = Math.max(minSizes[belowIdx], belowSize)

      // If clamping changed one, adjust the other
      let finalAbove = aboveClamped
      let finalBelow = belowClamped
      const totalPair =
        startSizes.current[aboveIdx] + startSizes.current[belowIdx]

      if (aboveClamped + belowClamped > totalPair) {
        // One hit its min — the other gets the rest
        if (aboveSize < minSizes[aboveIdx]) {
          finalAbove = minSizes[aboveIdx]
          finalBelow = totalPair - finalAbove
        } else {
          finalBelow = minSizes[belowIdx]
          finalAbove = totalPair - finalBelow
        }
      }

      setSizes((prev) => {
        const next = [...prev]
        next[aboveIdx] = finalAbove
        next[belowIdx] = finalBelow
        return next
      })
    }

    const onMouseUp = () => {
      if (dragging.current === null) return
      dragging.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
  }, [collapsedPanels, minSizes])

  return { sizes, onHandleMouseDown }
}
