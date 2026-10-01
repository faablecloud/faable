import type { FaableAuthApi } from '@faable/auth-sdk'
import fs from 'fs-extra'
import os from 'os'
import path from 'path'
import { ContextStore } from '../lib/ContextStore'
import { CredentialsStore } from '../lib/CredentialsStore'
import { log } from '../log'
import { FaableApi, FaableAuthAccount } from './FaableApi'
import { AUTH_DOMAIN, createAnonymousAuthApi, createBearerAuthApi } from './auth'
import { requireProject } from './project'
import { isTokenLive, loadLiveCredentials } from './session'
import { bearer_strategy } from './strategies/bearer.strategy'

export interface AuthAdminOpts {
  authUrl?: string
  account?: string
}

export interface Tenant {
  // The Auth account id (`x-faableauth-account`). Undefined only when an
  // --auth-url host couldn't be looked up: the server then picks by host.
  account?: string
  domain: string
  // How it was chosen — `faable whoami` and the errors say so.
  source: 'account' | 'auth-url' | 'project'
  project?: string
  name?: string
}

// The session bearer: FAABLE_TOKEN, else `faable login` (auto-refreshed).
export const requireSessionToken = async (): Promise<string> => {
  if (process.env.FAABLE_TOKEN) return process.env.FAABLE_TOKEN
  const config = await loadLiveCredentials(new CredentialsStore())
  if (config?.apikey && !config.token) {
    // Deploy API keys are not Auth management credentials.
    log.error(
      "❌ You are logged in with an API key, but `faable auth` needs a browser session. Run 'faable login' (without --apikey) first."
    )
    process.exit(1)
  }
  if (!config?.token) {
    log.error("❌ Not logged in. Run 'faable login' first.")
    process.exit(1)
  }
  return config.token
}

// Which Auth tenant `faable auth` manages, in precedence order:
//
//   1. --account / FAABLE_AUTH_ACCOUNT — an explicit tenant id;
//   2. --auth-url / FAABLE_AUTH_URL    — a tenant host, looked up;
//   3. the active project's tenant     — GET /project/:id/auth-accounts. One
//      tenant: that one. Several: the one `faable auth use` stored for the
//      project, or an error listing them.
//
// There is no default host any more: it used to be the Faable tenant, so a
// customer who forgot --auth-url was listing (or suspending) OUR users.
export const resolveTenant = async (
  opts: AuthAdminOpts,
  api: Pick<FaableApi, 'listProjects' | 'listProjectAuthAccounts'>,
  store = new ContextStore(),
  env = process.env
): Promise<Tenant> => {
  const account = opts.account || env.FAABLE_AUTH_ACCOUNT
  const authUrl = opts.authUrl || env.FAABLE_AUTH_URL
  if (account) {
    return { account, domain: authUrl || AUTH_DOMAIN, source: 'account' }
  }
  if (authUrl) {
    return {
      account: await resolveAccountByHost(authUrl),
      domain: authUrl,
      source: 'auth-url'
    }
  }

  const project = await requireProject(api, store, env)
  const accounts = (await api.listProjectAuthAccounts(project.id, { pageSize: 200 }))
    .results
  const chosen = await chooseAccount(project.id, accounts, store)
  return {
    account: chosen.id,
    domain: `https://${chosen.domain}`,
    source: 'project',
    project: project.id,
    name: chosen.name
  }
}

export const chooseAccount = async (
  project: string,
  accounts: FaableAuthAccount[],
  store = new ContextStore()
): Promise<FaableAuthAccount> => {
  if (accounts.length === 1) return accounts[0]
  if (accounts.length === 0) {
    throw new Error(
      `Project ${project} has no Faable Auth tenant. Create one in the dashboard (https://dashboard.faable.com), or target one with --account <account_id>.`
    )
  }
  const stored = (await store.load()).auth_accounts?.[project]
  const match = accounts.find(a => a.id === stored)
  if (match) return match
  const list = accounts.map(a => `${a.name} (${a.id})`).join(', ')
  throw new Error(
    `Project ${project} has ${accounts.length} Auth tenants: ${list}. Pick one with: faable auth use <account_id>, or pass --account <account_id>.`
  )
}

// A management-API client for the tenant `resolveTenant` picks, with the
// per-tenant token the deploy api issues (cached until it expires); the
// session bearer is the fallback where no such token exists.
export const requireAuthAdmin = async (
  opts: AuthAdminOpts = {}
): Promise<FaableAuthApi> => {
  const token = await requireSessionToken()
  const deploy = FaableApi.create({
    authStrategy: bearer_strategy,
    auth: { token }
  })
  const tenant = await resolveTenant(opts, deploy)
  const tenantToken = tenant.account
    ? await cachedTenantToken(token, tenant.account, deploy)
    : undefined

  return createBearerAuthApi(tenantToken ?? token, {
    domain: tenant.domain,
    account: tenant.account
  })
}

// Every `faable auth` call used to mint a fresh tenant token — one extra
// round trip per command, and a burst of them from a script or the MCP
// server. It lives for minutes (`expires_in`), so it's kept next to the
// credentials (0600) and reused while it's live, for the same session only.
export const cachedTenantToken = async (
  session_token: string,
  account_id: string,
  api: Pick<FaableApi, 'issueAuthAccountToken'>,
  cache = new TenantTokenCache()
): Promise<string | undefined> => {
  const sub = subject(session_token)
  const hit = await cache.get(account_id, sub)
  if (hit) return hit
  const issued = await issueTenantToken(session_token, account_id, api)
  if (issued) await cache.set(account_id, sub, issued)
  return issued
}

export const subject = (token: string): string | undefined => {
  try {
    const claims = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64url').toString()
    )
    return typeof claims.sub === 'string' ? claims.sub : undefined
  } catch {
    return undefined
  }
}

type CachedToken = { token: string; sub?: string }

export class TenantTokenCache {
  constructor(
    private file = path.join(os.homedir(), '.faable', 'tenant-tokens.json')
  ) {}

  private async read(): Promise<Record<string, CachedToken>> {
    try {
      return (await fs.readJSON(this.file)) || {}
    } catch {
      return {}
    }
  }

  async get(account_id: string, sub?: string) {
    const entry = (await this.read())[account_id]
    if (!entry || entry.sub !== sub || !isTokenLive(entry.token)) return
    return entry.token
  }

  async set(account_id: string, sub: string | undefined, token: string) {
    try {
      const all = await this.read()
      // Drop the dead ones while we're here.
      for (const [id, entry] of Object.entries(all)) {
        if (!isTokenLive(entry.token)) delete all[id]
      }
      all[account_id] = { token, sub }
      await fs.ensureDir(path.dirname(this.file))
      await fs.writeJSON(this.file, all, { spaces: 2, mode: 0o600 })
      await fs.chmod(this.file, 0o600)
    } catch {
      // A cache that can't be written is a cache miss next time, not an error.
    }
  }
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
      'Forbidden (403): your session is not allowed to manage this tenant. Check the tenant (`faable whoami`, --account, --project), or use credentials with management access for it.'
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
