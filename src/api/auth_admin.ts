import type { FaableAuthApi } from '@faable/auth-sdk'
import { CredentialsStore } from '../lib/CredentialsStore'
import { log } from '../log'
import { FaableApi } from './FaableApi'
import { createAnonymousAuthApi, createBearerAuthApi } from './auth'
import { loadLiveCredentials } from './session'
import { bearer_strategy } from './strategies/bearer.strategy'

// Default tenant host. `faable auth` is customer-facing: a customer targets
// their own tenant with --auth-url https://<account>.auth.faable.link (or
// FAABLE_AUTH_URL); the default points at the Faable tenant.
const DEFAULT_AUTH_URL = 'https://faable.auth.faable.link'

export interface AuthAdminOpts {
  authUrl?: string
  account?: string
}

// Build a management-API client for the Auth server reusing the CLI session
// (FAABLE_TOKEN → `faable login` credentials, auto-refreshed). The bearer is
// sent as-is and the SERVER decides whether it may manage the target tenant
// (today MGMT_AUTH_ENFORCE is authz dry-run; when enforced, tokens without the
// management audience/scopes for the tenant will get 403 — see
// auth/docs/management-api-m2m-token.md for the M2M path).
export const requireAuthAdmin = async (
  opts: AuthAdminOpts = {}
): Promise<FaableAuthApi> => {
  let token = process.env.FAABLE_TOKEN
  if (!token) {
    const store = new CredentialsStore()
    const config = await loadLiveCredentials(store)
    if (config?.apikey && !config.token) {
      // Deploy API keys are not Auth management credentials.
      log.error(
        "❌ You are logged in with an API key, but `faable auth` needs a browser session. Run 'faable login' (without --apikey) first."
      )
      process.exit(1)
    }
    token = config?.token
  }
  if (!token) {
    log.error("❌ Not logged in. Run 'faable login' first.")
    process.exit(1)
  }

  const domain = opts.authUrl || process.env.FAABLE_AUTH_URL || DEFAULT_AUTH_URL
  const account = opts.account || process.env.FAABLE_AUTH_ACCOUNT

  const tenant = account ?? (await resolveAccountByHost(domain))
  const tenantToken = tenant ? await issueTenantToken(token, tenant) : undefined

  // Prefer the per-tenant management token; the session's bearer is the
  // fallback (the platform tenant, or an api that can't issue one), exactly
  // what `faable auth` sent before phase 2. Either way, scoped to the tenant.
  return createBearerAuthApi(tenantToken ?? token, {
    domain,
    account: tenant ?? account
  })
}

// The tenant behind an Auth host (`<slug>.auth.faable.link` or a custom
// domain), through the anonymous public lookup. `undefined` when it can't be
// resolved: the server then picks the tenant from the host, as before.
export const resolveAccountByHost = async (
  domain: string,
  auth = createAnonymousAuthApi({ domain })
): Promise<string | undefined> => {
  try {
    const host = new URL(domain).host
    const account = await auth.fetcher.get<{
      id?: string
    }>(`/account/host/${host}`)
    return account?.id
  } catch {
    return undefined
  }
}

// Statuses that mean "no per-tenant token for this one right now" — the
// platform tenant (404 tenant_token_not_issued), an api without the endpoint,
// or auth unable to mint. Anything else (403: not a member) is a real refusal.
const FALLBACK_STATUSES = new Set([404, 501, 503])

export const issueTenantToken = async (
  session_token: string,
  account_id: string,
  api: Pick<FaableApi, 'issueAuthAccountToken'> = FaableApi.create({
    authStrategy: bearer_strategy,
    auth: { token: session_token }
  })
): Promise<string | undefined> => {
  try {
    const { access_token } = await api.issueAuthAccountToken(account_id)
    return access_token
  } catch (e) {
    const status = (e as { response?: { status?: number } })?.response?.status
    if (status === 403) {
      throw new Error(
        `Forbidden (403): you are not a member of the project that owns ${account_id}, so you can't manage it.`,
        { cause: e }
      )
    }
    if (status === undefined || FALLBACK_STATUSES.has(status)) return undefined
    throw e
  }
}

// Translate raw management-API failures into actionable CLI errors. Everything
// else is rethrown untouched (FaableApiError messages already carry
// status+url) and lands in the global yargs .fail() handler.
export const hintAuthError = (e: unknown): never => {
  const status = (e as { response?: { status?: number } })?.response?.status
  if (status === 401) {
    throw new Error(
      "Unauthorized (401) by the Auth management API. Your session may have expired — run 'faable login' and retry."
    )
  }
  if (status === 403) {
    throw new Error(
      'Forbidden (403): your session is not allowed to manage this tenant. Check --auth-url/--account, or use credentials with management access for it.'
    )
  }
  throw e
}

// Wrap a yargs handler so management-API errors surface with the hints above.
export const withAuthHints = <A>(
  handler: (args: A) => Promise<void>
): ((args: A) => Promise<void>) => {
  return async args => {
    try {
      await handler(args)
    } catch (e) {
      hintAuthError(e)
    }
  }
}
