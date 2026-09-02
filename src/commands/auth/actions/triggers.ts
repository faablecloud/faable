// `triggers` (auth ≥ v1.58) replaced the hand-picked `trigger`: an action runs
// on every trigger whose hook its code exports. Tolerates both shapes so the
// CLI prints something sensible against either server version.
export const formatTriggers = (action: {
  triggers?: string[]
  trigger?: string
}): string => {
  const list = action.triggers?.length
    ? action.triggers
    : action.trigger
      ? [action.trigger]
      : []
  return list.length ? list.join(',') : '-'
}
