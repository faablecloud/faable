import type { FaableAuthApi } from '@faable/auth-sdk'
import { CliError } from '../../../lib/errors'
import { fetch_page, from_paginator } from '../../../lib/listing'

export interface UserCredential {
  id: string
  connection: string
  email?: string
  username?: string
}

// The database credential a password login matches — the email/username the
// user actually types, which can differ from their profile email. One per
// database connection: a single-connection tenant has exactly one. With more,
// `connection` (id or the name it was created with) disambiguates. Throws when
// the user has none (they sign in only through social/passwordless).
export const resolve_user_credential = async (
  api: Pick<FaableAuthApi, 'credentialsList'>,
  user_id: string,
  connection?: string
): Promise<UserCredential> => {
  const { data } = await fetch_page(
    from_paginator(api.credentialsList({ user: user_id } as never)),
    { limit: 200, all: true }
  )
  const creds: UserCredential[] = (data as Record<string, unknown>[]).map(c => ({
    id: String(c.id ?? ''),
    connection: String(c.connection ?? ''),
    email: c.email as string | undefined,
    username: c.username as string | undefined
  }))
  if (creds.length === 0) {
    throw new CliError(
      'not_found',
      `User ${user_id} has no database credential — they sign in only through a social or passwordless connection.`
    )
  }
  if (connection) {
    const match = creds.filter(c => c.connection === connection)
    if (match.length === 1) return match[0]
    throw new CliError(
      'usage',
      `User ${user_id} has no single credential on connection ${connection} (${match.length} matched).`
    )
  }
  if (creds.length > 1) {
    throw new CliError(
      'usage',
      `User ${user_id} has ${creds.length} database credentials (${creds
        .map(c => c.connection)
        .join(', ')}): pass --connection.`
    )
  }
  return creds[0]
}

// A user given as an id (`user_…`) or as an email. An email is looked up with
// an exact `?email=` (stored lowercase) and must match ONE user: a write by
// email never acts on a partial or ambiguous match.
export const resolve_user_ref = async (
  api: Pick<FaableAuthApi, 'userList'>,
  ref: string
): Promise<string> => {
  const value = ref.trim()
  if (/^user_[0-9a-f]{24}$/.test(value)) return value
  if (!value.includes('@')) {
    throw new CliError(
      'usage',
      `"${ref}" is neither a user id (user_…) nor an email.`
    )
  }
  const email = value.toLowerCase()
  const page = await api
    .userList({ email, pageSize: '2' } as never)
    .pass({ pageSize: '2' } as never)
  const matches = (page.results ?? []) as Array<{ id: string; email?: string }>
  const exact = matches.filter(u => u.email?.toLowerCase() === email)
  if (exact.length === 0) {
    throw new CliError('not_found', `No user with email ${email} in this tenant.`)
  }
  if (exact.length > 1) {
    throw new CliError(
      'usage',
      `${exact.length} users have email ${email} (${exact
        .map(u => u.id)
        .join(', ')}): pass the user id.`
    )
  }
  return exact[0].id
}

export const resolve_user_refs = async (
  api: Pick<FaableAuthApi, 'userList'>,
  refs: string[]
): Promise<string[]> => {
  const out: string[] = []
  for (const ref of refs) out.push(await resolve_user_ref(api, ref))
  return out
}
