import { useState, useCallback, useRef, useEffect } from 'react'

interface UseMultiPanelResizeOptions {
  containerSize: number
  minSizes: number[]
  initialRatios: number[]
  collapsedPanels: boolean[]
  collapsedSize: number
}

// Distribute `total` across `values` proportionally, then clamp each to its
// minimum and redistribute the deficit across panels that still have room.
// Iterates until stable. If the minimums can't fit, every panel is pinned at
// its minimum and the result will exceed `total`.
function waterFill(values: number[], mins: number[], total: number): number[] {
  const n = values.length
  if (n === 0) return []
  const result = [...values]
  const pinned = new Array(n).fill(false)

  for (let iter = 0; iter < n + 1; iter++) {
    let deficit = 0
    for (let i = 0; i < n; i++) {
      if (!pinned[i] && result[i] < mins[i]) {
        deficit += mins[i] - result[i]
        result[i] = mins[i]
        pinned[i] = true
      }
    }
    if (deficit === 0) break

    const flexibleSum = result.reduce(
      (s, v, i) => (pinned[i] ? s : s + v),
      0
    )
    if (flexibleSum <= 0) break

    for (let i = 0; i < n; i++) {
      if (!pinned[i]) {
        result[i] = Math.max(0, result[i] - (deficit * result[i]) / flexibleSum)
      }
    }
  }

  const pinnedTotal = result.reduce((s, v, i) => (pinned[i] ? s + v : s), 0)
  const flexibleTarget = Math.max(0, total - pinnedTotal)
  const flexibleSum = result.reduce((s, v, i) => (pinned[i] ? s : s + v), 0)
  if (flexibleSum > 0 && flexibleTarget > 0) {
    const scale = flexibleTarget / flexibleSum
    for (let i = 0; i < n; i++) {
      if (!pinned[i]) result[i] *= scale
    }
  }
  return result
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
    new Array(panelCount).fill(0)
  )
  const dragging = useRef<number | null>(null)
  const startY = useRef(0)
  const startSizes = useRef<number[]>([])
  const minSizesRef = useRef(minSizes)
  minSizesRef.current = minSizes
  const collapsedRef = useRef(collapsedPanels)
  collapsedRef.current = collapsedPanels
  const initialRatiosRef = useRef(initialRatios)

  // Each panel's intended expanded size. Seeded from initialRatios on the
  // first non-zero containerSize, then updated only by drags. Used as the
  // ratio source for the recalc, so a collapse → expand cycle restores the
  // panel to a sensible size instead of getting stuck at min.
  const expandedSizesRef = useRef<number[]>(new Array(panelCount).fill(0))
  const seededRef = useRef(false)

  useEffect(() => {
    if (containerSize <= 0) return

    if (!seededRef.current) {
      const ratios = initialRatiosRef.current
      const ratioSum = ratios.reduce((a, b) => a + b, 0) || 1
      for (let i = 0; i < panelCount; i++) {
        expandedSizesRef.current[i] = Math.max(
          minSizesRef.current[i],
          Math.round((containerSize * ratios[i]) / ratioSum)
        )
      }
      seededRef.current = true
    }

    const collapsedTotal = collapsedPanels.reduce(
      (sum, c) => sum + (c ? collapsedSize : 0),
      0
    )
    const availableSpace = Math.max(0, containerSize - collapsedTotal)

    const expandedIdx: number[] = []
    for (let i = 0; i < panelCount; i++) {
      if (!collapsedPanels[i]) expandedIdx.push(i)
    }

    const next = new Array(panelCount).fill(0)
    collapsedPanels.forEach((c, i) => {
      if (c) next[i] = collapsedSize
    })

    if (expandedIdx.length === 0 || availableSpace <= 0) {
      setSizes(next)
      return
    }

    const hints = expandedIdx.map((i) =>
      Math.max(minSizesRef.current[i], expandedSizesRef.current[i])
    )
    const hintTotal = hints.reduce((a, b) => a + b, 0)

    const raw =
      hintTotal > 0
        ? hints.map((h) => (availableSpace * h) / hintTotal)
        : new Array(expandedIdx.length).fill(
            availableSpace / expandedIdx.length
          )

    const filled = waterFill(
      raw,
      expandedIdx.map((i) => minSizesRef.current[i]),
      availableSpace
    )

    const rounded = filled.map(Math.round)
    const drift = availableSpace - rounded.reduce((a, b) => a + b, 0)
    if (rounded.length > 0) rounded[rounded.length - 1] += drift

    expandedIdx.forEach((i, k) => {
      next[i] = rounded[k]
    })

    setSizes(next)
  }, [containerSize, collapsedPanels, collapsedSize, panelCount])

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

      // Walk outward from the handle to find the nearest expanded panels.
      // Collapsed neighbours are skipped so a handle adjacent to a collapsed
      // section still resizes the next pair of expanded sections.
      const collapsed = collapsedRef.current
      let aboveIdx = handleIdx
      while (aboveIdx >= 0 && collapsed[aboveIdx]) aboveIdx--
      let belowIdx = handleIdx + 1
      while (belowIdx < panelCount && collapsed[belowIdx]) belowIdx++
      if (aboveIdx < 0 || belowIdx >= panelCount) return

      const aboveSize = startSizes.current[aboveIdx] + delta
      const belowSize = startSizes.current[belowIdx] - delta

      const mins = minSizesRef.current
      const aboveClamped = Math.max(mins[aboveIdx], aboveSize)
      const belowClamped = Math.max(mins[belowIdx], belowSize)

      let finalAbove = aboveClamped
      let finalBelow = belowClamped
      const totalPair =
        startSizes.current[aboveIdx] + startSizes.current[belowIdx]

      if (aboveClamped + belowClamped > totalPair) {
        if (aboveSize < mins[aboveIdx]) {
          finalAbove = mins[aboveIdx]
          finalBelow = totalPair - finalAbove
        } else {
          finalBelow = mins[belowIdx]
          finalAbove = totalPair - finalBelow
        }
      }

      setSizes((prev) => {
        const next = [...prev]
        next[aboveIdx] = finalAbove
        next[belowIdx] = finalBelow
        expandedSizesRef.current[aboveIdx] = finalAbove
        expandedSizesRef.current[belowIdx] = finalBelow
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
  }, [panelCount])

  return { sizes, onHandleMouseDown }
}
