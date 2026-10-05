import type { FaableAuthApi } from '@faable/auth-sdk'
import { CliError } from '../../../lib/errors'

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
