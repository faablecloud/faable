import { FaableAuthApi } from '@faable/auth-sdk'
import { CredentialsStore } from '../lib/CredentialsStore'
import { log } from '../log'
import { loadLiveCredentials } from './session'

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

  return new FaableAuthApi({
    domain,
    ...(account ? { headers: { account_id: account } } : {}),
    // Static bearer: passing no `auth` keeps sdk-base from attaching any token
    // strategy, so this header is used verbatim on every request.
    fetcher: { headers: { Authorization: `Bearer ${token}` } }
  })
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
