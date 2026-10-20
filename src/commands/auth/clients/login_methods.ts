// A client's own `login_methods` overrides the tenant's FIELD BY FIELD
// (auth: resolveLoginMethodsConfig): a field the client does not set is
// inherited. The update route stores the object whole, so every change here is
// a read-modify-write of what the client has now, and a field this command was
// not asked about keeps whatever it was — its own value or the inheritance.

export type LoginMethodsConfig = {
  order?: string[]
  disabled_connections?: string[]
  passkey_login_enabled?: boolean
  [key: string]: unknown
}

export type ConnectionRef = {
  id: string
  connection_name?: string
  connection_type?: string
}

export type PasskeyChoice = 'on' | 'off' | 'inherit'

export type LoginMethodChanges = {
  // Offer exactly these connections; every other one is removed.
  only?: string[]
  disable?: string[]
  enable?: string[]
  passkey?: PasskeyChoice
  // Drop the client's own settings and follow the tenant again.
  inherit?: boolean
}

export const has_login_method_changes = (c: LoginMethodChanges) =>
  !!(
    c.inherit ||
    c.passkey ||
    c.only?.length ||
    c.disable?.length ||
    c.enable?.length
  )

/**
 * A connection by id or by name (case-insensitive). A name two connections
 * share is refused rather than guessed: removing the wrong login method is
 * not something to find out on the login screen.
 */
export const resolve_connection = (
  connections: ConnectionRef[],
  ref: string
): ConnectionRef => {
  const by_id = connections.find(c => c.id === ref)
  if (by_id) return by_id
  const by_name = connections.filter(
    c => c.connection_name?.toLowerCase() === ref.toLowerCase()
  )
  if (by_name.length === 1) return by_name[0]
  const known = connections
    .map(c => `${c.connection_name ?? '?'} (${c.id})`)
    .join(', ')
  if (by_name.length > 1) {
    throw new Error(
      `"${ref}" names ${by_name.length} connections — use the id: ${by_name.map(c => c.id).join(', ')}`
    )
  }
  throw new Error(`Unknown connection "${ref}". This tenant has: ${known}`)
}

/**
 * The client's next `login_methods`, or `null` to inherit everything from the
 * tenant. `undefined` when nothing was asked for.
 */
export const apply_login_method_changes = (
  own: LoginMethodsConfig | null | undefined,
  tenant: LoginMethodsConfig | null | undefined,
  connections: ConnectionRef[],
  changes: LoginMethodChanges
): LoginMethodsConfig | null | undefined => {
  if (!has_login_method_changes(changes)) return undefined
  if (changes.inherit) return null

  const next: LoginMethodsConfig = { ...(own ?? {}) }

  if (changes.only?.length || changes.disable?.length || changes.enable?.length) {
    // Starts from what the client shows TODAY: its own list, or the tenant's
    // it inherits — otherwise the first own list would silently re-offer
    // everything the tenant had removed.
    const disabled = new Set(
      own?.disabled_connections ?? tenant?.disabled_connections ?? []
    )
    if (changes.only?.length) {
      const keep = new Set(
        changes.only.map(ref => resolve_connection(connections, ref).id)
      )
      disabled.clear()
      for (const c of connections) if (!keep.has(c.id)) disabled.add(c.id)
    }
    for (const ref of changes.disable ?? []) {
      disabled.add(resolve_connection(connections, ref).id)
    }
    for (const ref of changes.enable ?? []) {
      disabled.delete(resolve_connection(connections, ref).id)
    }
    next.disabled_connections = [...disabled]
  }

  if (changes.passkey === 'on') next.passkey_login_enabled = true
  else if (changes.passkey === 'off') next.passkey_login_enabled = false
  else if (changes.passkey === 'inherit') delete next.passkey_login_enabled

  return Object.keys(next).length ? next : null
}

/** What the login screen of this client offers, for the summary line. */
export const effective_login_methods = (
  own: LoginMethodsConfig | null | undefined,
  tenant: LoginMethodsConfig | null | undefined,
  connections: (ConnectionRef & { enabled?: boolean })[]
) => {
  const disabled = new Set(
    own?.disabled_connections ?? tenant?.disabled_connections ?? []
  )
  const order = new Set(own?.order ?? tenant?.order ?? [])
  const passkey =
    own?.passkey_login_enabled ?? tenant?.passkey_login_enabled ?? false
  return {
    passkey,
    // OIDC providers stay off the screen unless `order` names them.
    connections: connections.filter(
      c =>
        c.enabled !== false &&
        !disabled.has(c.id) &&
        (c.connection_type !== 'oidc' || order.has(c.id))
    )
  }
}
