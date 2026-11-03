/** The tab to activate after `removedId` is closed: the one that slides into its slot, else the new last. */
export function neighbourAfterClose(ids: string[], removedId: string): string | null {
  const idx = ids.indexOf(removedId)
  const rest = ids.filter((id) => id !== removedId)
  if (rest.length === 0) return null
  return rest[Math.min(Math.max(idx, 0), rest.length - 1)]
}
