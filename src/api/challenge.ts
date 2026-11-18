import { CliError } from '../lib/errors'
import { requireSessionToken } from './auth_admin'
import { CLI_CLIENT } from './client_id'

// Faable Challenge's site API (the `challenge` service, management section of
// its src/server.ts). It is not part of api.faable.com: it takes the user's
// own Faable token (it checks the signature against Faable Auth's JWKS and
// asks the api whether the user belongs to the project), so the same
// `faable login` session — or FAABLE_TOKEN, the hosted MCP's delegated
// token — works, and a deploy API key does not.
//
// FAABLE_CHALLENGE_URL points it at another instance.
export const CHALLENGE_URL = (
  process.env.FAABLE_CHALLENGE_URL || 'https://challenge.faable.com'
).replace(/\/$/, '')

export interface ChallengeSite {
  id: string
  project_id: string
  name: string
  domains: string[]
  site_key: string
  secret_rotated_at: string
  created_at: string
  updated_at: string
}

// Create and rotate are the only answers that carry the secret, once.
export type ChallengeSiteWithSecret = ChallengeSite & { secret: string }

export interface ChallengeUsage {
  month: string
  issued: number
  answered: number
  verified: number
  verify_failed: number
  sites: number
  plan: {
    tier: string
    verifications_month: number | null
    sites: number | null
  } | null
  [k: string]: unknown
}

// The service's error codes, said for a person. A code the service sends
// with its own `message` (plan_required, invalid_domains) keeps that one.
const MESSAGES: Record<string, string> = {
  invalid_token:
    'Faable Challenge did not accept the session. Run `faable login` to sign in again.',
  project_not_found:
    'No such project, or you are not a member of it. See yours with: faable project list',
  role_required:
    'Your role in this project is viewer: managing Challenge sites needs member or owner.',
  site_not_found:
    'No such Challenge site in this project. See them with: faable challenge sites list',
  name_required: 'A site needs a name.',
  api_unavailable:
    'Faable Challenge could not check your project membership right now. Retry in a minute.'
}

export const challenge_error = (
  status: number,
  body: { error?: string; message?: string } | undefined
) => {
  const code = body?.error
  const message =
    body?.message ||
    (code && MESSAGES[code]) ||
    `Faable Challenge answered ${status}${code ? ` (${code})` : ''}`
  const e = new Error(message) as Error & { status: number; code?: string }
  e.status = status
  e.code =
    code === 'invalid_token'
      ? 'session_expired'
      : (code ??
        (status === 404
          ? 'not_found'
          : status === 403
            ? 'forbidden'
            : undefined))
  return e
}

// The token Challenge takes: a Faable Auth JWT. A deploy API key is not one.
export const requireChallengeToken = async (
  env = process.env
): Promise<string> => {
  if (!env.FAABLE_TOKEN && env.FAABLE_API_KEY) {
    throw new CliError(
      'apikey_session',
      'Faable Challenge takes a Faable login, not a deploy API key. Run `faable login` (or, on mcp.faable.com, connect by signing in instead of with an API key).'
    )
  }
  return requireSessionToken()
}

export class ChallengeApi {
  constructor(
    private token: string,
    private base = CHALLENGE_URL,
    private doFetch: typeof fetch = fetch
  ) {}

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    let res: Response
    try {
      res = await this.doFetch(`${this.base}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.token}`,
          'x-faable-client': CLI_CLIENT,
          ...(body === undefined ? {} : { 'content-type': 'application/json' })
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15_000)
      })
    } catch (e) {
      throw new Error(
        `Could not reach Faable Challenge (${this.base}): ${(e as Error).message}`,
        { cause: e }
      )
    }
    if (res.status === 204) return undefined as T
    const data = (await res.json().catch(() => undefined)) as any
    if (!res.ok) throw challenge_error(res.status, data)
    return data as T
  }

  private sites_path = (project: string, site?: string) =>
    `/v1/projects/${encodeURIComponent(project)}/sites` +
    (site ? `/${encodeURIComponent(site)}` : '')

  async listSites(project: string): Promise<ChallengeSite[]> {
    const { results } = await this.request<{ results: ChallengeSite[] }>(
      'GET',
      this.sites_path(project)
    )
    return results
  }

  createSite(project: string, input: { name: string; domains: string[] }) {
    return this.request<ChallengeSiteWithSecret>(
      'POST',
      this.sites_path(project),
      input
    )
  }

  updateSite(
    project: string,
    site: string,
    input: { name?: string; domains?: string[] }
  ) {
    return this.request<ChallengeSite>(
      'PATCH',
      this.sites_path(project, site),
      input
    )
  }

  async deleteSite(project: string, site: string): Promise<void> {
    await this.request<void>('DELETE', this.sites_path(project, site))
  }

  rotateSecret(project: string, site: string) {
    return this.request<ChallengeSiteWithSecret>(
      'POST',
      `${this.sites_path(project, site)}/secret`
    )
  }

  getUsage(project: string) {
    return this.request<ChallengeUsage>(
      'GET',
      `/v1/projects/${encodeURIComponent(project)}/usage`
    )
  }
}

const SITE_ID_RE = /^site_[0-9a-f]{24}$/

// A site by id, site key or name (exactly one of the project's must match).
export const resolveSite = async (
  api: Pick<ChallengeApi, 'listSites'>,
  project: string,
  ref: string
): Promise<ChallengeSite> => {
  const sites = await api.listSites(project)
  const byId = sites.find(s => s.id === ref || s.site_key === ref)
  if (byId) return byId
  if (SITE_ID_RE.test(ref)) {
    throw new CliError(
      'not_found',
      `No Challenge site ${ref} in project ${project}. See them with: faable challenge sites list`
    )
  }
  const wanted = ref.toLowerCase()
  const matches = sites.filter(s => s.name.toLowerCase() === wanted)
  if (matches.length === 1) return matches[0]
  throw new CliError(
    'not_found',
    matches.length === 0
      ? `No Challenge site named "${ref}" in project ${project}. See them with: faable challenge sites list`
      : `Several Challenge sites are named "${ref}": ${matches.map(s => s.id).join(', ')}. Use its id.`
  )
}
