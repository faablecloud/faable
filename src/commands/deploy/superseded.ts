/**
 * Superseded detection for the promotion wait (deploy v3, twin-workflow
 * case): the app's promoted pointer only ever moves FORWARD (the controller
 * refuses to promote a deployment older than the active one), so once a
 * deployment at-least-as-new as ours is promoted, waiting longer can never
 * succeed. Twins from duplicated workflows land here — one wins the pointer,
 * the other must exit cleanly instead of hanging to the timeout.
 *
 * `>=` on purpose: same-instant twins (created ms apart) supersede each
 * other in whichever order the promoter resolved them.
 */
export const is_superseded = (
  mine: { id: string; createdAt: string },
  active: { id: string; createdAt: string } | null | undefined
): boolean =>
  Boolean(
    active &&
      active.id !== mine.id &&
      new Date(active.createdAt).getTime() >=
        new Date(mine.createdAt).getTime()
  )
