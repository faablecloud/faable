import {
  AxiosError,
  AxiosInstance,
  AxiosResponse,
  InternalAxiosRequestConfig
} from 'axios'
import { create_base_client } from './base_client'
import { AuthStrategy, AuthStrategyBuilder } from './strategies/types'

// Socket-level failures where no response ever arrived: the connection died
// before the server produced anything, so a single retry is safe for any
// method (a reset mid-flight means the request was not processed).
const RESET_CODES = new Set(['ECONNRESET', 'EPIPE'])
const RETRY_DELAY_MS = 300

const is_connection_reset = (e: AxiosError) =>
  e.isAxiosError &&
  !e.response &&
  (RESET_CODES.has(e.code ?? '') || e.message.includes('socket hang up'))

// The api's tenant header is `x-faable-project: project_<hex>`; the old
// `x-faable-team` is deprecated. A project and a team share the hex suffix,
// so the app's `team` (`team_<hex>`) maps 1:1. Never send both: the api
// rejects a pair that disagrees.
export const projectHeader = (team: string) => ({
  'x-faable-project': team.replace(/^team_/, 'project_')
})
export interface FaableProject {
  id: string
  name: string
  slug?: string
  team: string
  description?: string
  owner_email?: string
  createdAt?: string
}

// A Faable Auth tenant ("account") owned by a project, as
// GET /project/:id/auth-accounts serves it.
export interface FaableAuthAccount {
  id: string
  name: string
  domain: string
  slug?: string
  team?: string
}

export interface PageParams {
  pageSize?: number
  next?: string
}

export interface FaableApp {
  id: string
  name: string
  slug?: string
  url: string
  team: string
  repository: string
  // Remote-build rollout gate (server-decided; the CLI follows it).
  build_mode?: 'local' | 'remote'
  // Monorepo Root Directory (Vercel-style; server-decided source of truth).
  // The app lives in <repo>/<root_dir>; the CLI resolves the plan there.
  root_dir?: string | null
  github_branch?: string
  // Push-to-deploy trigger (deploy v4). 'webhook' = the platform deploys
  // every push server-side; null/absent = the repo's own GitHub Actions
  // workflow deploys (legacy or user-managed CI).
  deploy_trigger?: string | null
  // What the platform build detected (buildpack/framework/runtime), reported
  // by the builder before building — present on failed builds too.
  detected?: DeploymentDetected | null
  status?: {
    phase: string
    deployment: string | null
  }
}

export interface FaableDeployment {
  id: string
  app_id?: string
  team?: string
  release?: string
  image?: string
  github_commit?: string
  github_commit_message?: string
  github_ref?: string
  github_actor?: string
  // Ref to the build payload row (source manifest + runnable descriptor).
  // Present on every remote build; absent on a legacy image deploy.
  artifact_id?: string
  artifact_ready_at?: string
  // Set when this deployment is a rebuild of a failed one.
  redeploy_of?: string
  quota_released_at?: string
  trigger?: string | null
  detected?: DeploymentDetected
  createdAt?: string
  status?: {
    phase?: string
    reason?: string
    controlled_at?: string
    controlled_by?: string
    // Artifact deploys: the digest-pinned runtime image the controller
    // resolved at first materialization (write-once).
    runtime_image?: string
  }
}

// Platform-detected stack, reported by the builder BEFORE building (so it
// survives a failed build). Same shape on the app and on the deployment.
export interface DeploymentDetected {
  buildpack: string
  framework?: string
  runtime: { name: string; version?: string }
}

// The deploy-v3 runnable descriptor, served by GET /artifact/:id. The source
// manifest is deliberately not part of this view.
export interface FaableArtifact {
  id: string
  deployment_id: string
  app_id: string
  artifact?: {
    sha256: string
    size: number
    format: string
    runtime: { name: string; version?: string | null }
    profile: string
    start_command?: string | null
  }
  purged_at?: string
}

// Runtime log line as the API serves it (Loki-backed, newest first, last
// 24h, up to 200 lines): [ns_timestamp, text, deployment_id].
export type AppLogLine = [string | number, string, string?]

export interface GithubRepo {
  id: number
  full_name: string
  private: boolean
  default_branch: string
  installation_id: number
}

export interface GithubInstallation {
  installation_id: number
  account_login: string
  account_type: string
  account_avatar_url?: string
  app_slug: string
}

/**
 * One WAF rule an app's owners authored (GET/POST /app/:id/waf).
 *
 * `match` says which fields are meaningful: 'path' → `pattern`, 'user_agent' →
 * `user_agent`, 'query' → `query`, and the combined 'path_user_agent' /
 * 'path_query' → both, where BOTH must match for the rule to fire.
 */
export interface FaableWafRule {
  pattern?: string
  user_agent?: string
  /** Literal query parameter name (never a regex). */
  query?: string
  /** 'deny' → 403 at the edge; 'sink' → synthetic 404, the app is not woken. */
  action: string
  match?: string
  description?: string
}

/**
 * A platform ruleset protecting this app. `rules` is only populated for
 * admins — the global patterns are not tenant-readable.
 */
export interface FaableWafPlatformProfile {
  name: string
  action: string
  /** What the ruleset matches on — without it a `probe` reads like a block. */
  match?: string
  rule_count: number
  rules?: Array<{
    pattern: string
    user_agent?: string
    query?: string
    description?: string
  }>
}

export interface FaableAppWaf {
  /** Master toggle of the app's WAF binding (admin-controlled). */
  enabled: boolean
  platform_profiles: FaableWafPlatformProfile[]
  rules: FaableWafRule[]
}

export interface FaableDomain {
  id: string
  fqdn: string
  tls: boolean
  app_id?: string | null
  verified: boolean
  active: boolean
  team: string
  // Outcome of the DNS verification worker's latest check. `dns_expected`
  // carries the CNAME target(s) the user must configure — the same
  // `<domain.id>.faable.link` the dashboard instructions show.
  status?: {
    dns_state?: 'pending' | 'ok' | 'misconfigured' | 'error'
    dns_checked_at?: string | null
    dns_expected?: string[]
    dns_observed?: string[]
    dns_message?: string | null
  }
}

export interface Secret {
  id: string
  related: string
  // "app" for the app's own secrets, "profile" for secrets inherited from
  // the team profile (returned by GET /secret/:app_id but not editable
  // through the app context).
  related_model: 'app' | 'profile'
  name: string
  value: string
}

export type Page<Q> = { results: Q[]; next?: string | null }

const firstPage = async <T, Q extends Promise<Page<T>>>(
  res: Q
): Promise<Awaited<Q>['results']> => {
  const items = (await res).results
  return items
}

// Walk the cursor to exhaustion. `list()` needs this instead of `firstPage`:
// a user who sees many apps (admins see all of them) gets a multi-page
// listing, and matching by repository against a truncated first page made
// every repo-resolved command answer "No app linked to this repository".
const allPages = async <T>(
  fetch_page: (next?: string) => Promise<Page<T>>
): Promise<T[]> => {
  const items: T[] = []
  let next: string | undefined
  do {
    const page = await fetch_page(next)
    items.push(...page.results)
    next = page.next ?? undefined
  } while (next)
  return items
}

// Only what's set: the list endpoints answer 400 to an unknown or empty param.
const page_params = ({ pageSize, next }: PageParams) => ({
  ...(pageSize ? { pageSize } : {}),
  ...(next ? { next } : {})
})

const data = async <T, Q extends Promise<AxiosResponse<T>>>(
  res: Q
): Promise<Awaited<Q>['data']> => {
  const items = (await res).data
  return items
}

export type FaableClientConfig<T = any> = {
  authStrategy?: AuthStrategyBuilder<T>
  auth?: T
}

type FaableApiConfig<T> = {} & FaableClientConfig<T>

export class FaableApi<T = any> {
  client: AxiosInstance
  strategy?: AuthStrategy
  // The active project (`--project`, FAABLE_PROJECT, `faable project use`),
  // when there is one. Project-wide listings are scoped to it; calls about
  // one app keep using that app's own project.
  project?: string

  constructor(config: FaableApiConfig<T>) {
    const { authStrategy, auth } = config
    this.client = create_base_client()
    this.strategy = authStrategy && authStrategy(auth)

    const strategy = this.strategy
    this.client.interceptors.request.use(
      async function (config) {
        // Do something before request is sent
        const headers = strategy ? await strategy.headers() : {}
        config.headers.set(headers)
        // console.log("all headers");
        // console.log(headers);
        return config
      },
      function (error) {
        // Do something with request error
        return Promise.reject(error)
      }
    )

    // Registered before the error-wrapping interceptor so it sees the raw
    // axios error. Retries once per request; the retried call re-enters the
    // full chain (auth headers included).
    const client = this.client
    this.client.interceptors.response.use(undefined, async error => {
      const e: AxiosError = error
      const config = e.config as
        (InternalAxiosRequestConfig & { _retried?: boolean }) | undefined
      if (config && !config._retried && is_connection_reset(e)) {
        config._retried = true
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS))
        return client.request(config)
      }
      throw error
    })

    this.client.interceptors.response.use(
      response => response,
      error => {
        const e: AxiosError<{
          message: string
          code?: string
          action?: string
        }> = error
        if (e.isAxiosError) {
          const res = e.response
          const url = e.config?.url || ''
          if (res) {
            // Uniform handling for an expired/invalid session across every
            // command, regardless of which endpoint returned the 401.
            if (res.status === 401) {
              // With an API key there is no session to renew: the key itself
              // is wrong or was revoked (the hosted MCP server runs on keys).
              const by_key = !!process.env.FAABLE_API_KEY && !process.env.FAABLE_TOKEN
              const expired = new Error(
                by_key
                  ? 'This Faable API key is invalid or was revoked. Create a new one in the dashboard (project settings → API Keys).'
                  : 'Your Faable session has expired or is invalid. Run `faable login` to sign in again.',
                { cause: error }
              )
              ;(expired as any).status = 401
              ;(expired as any).code = by_key ? 'apikey_invalid' : 'session_expired'
              throw expired
            }
            const serverMessage =
              res.data?.message || res.statusText || 'Unknown Error'
            const wrapped = new Error(
              `FaableApi ${url} ${res.status}: ${serverMessage}`,
              { cause: error }
            )
            // Surface the structured error contract (e.g. the repository-link
            // flow returns { code, action }) so callers can branch on it.
            ;(wrapped as any).status = res.status
            // The api's own code wins; a bare 403/404 still gets a stable one.
            if (res.data?.code) (wrapped as any).code = res.data.code
            else if (res.status === 403) (wrapped as any).code = 'forbidden'
            else if (res.status === 404) (wrapped as any).code = 'not_found'
            if (res.data?.action) (wrapped as any).action = res.data.action
            throw wrapped
          } else {
            throw new Error(`FaableApi ${url} ${e.message}`, { cause: error })
          }
        }
        throw error
      }
    )
  }

  static create<T>(config: FaableApiConfig<T> = {}) {
    return new FaableApi(config)
  }

  // A short-lived Management API token for ONE Faable Auth tenant, issued by
  // the deploy api after checking the caller belongs to the project that owns
  // it (phase 2 of arch/auth/management-api-tenant-isolation.md). `faable auth`
  // manages tenants with it instead of the `faable login` token, which stops
  // being platform-superadmin in phase 3.
  async issueAuthAccountToken(account_id: string) {
    return data(
      this.client.post<{ access_token: string; expires_in: number }>(
        `/auth-accounts/${account_id}/token`
      )
    )
  }

  // Every app the caller can see, across projects. Used to match the working
  // directory's repository to its app: the link is global, so a repo whose
  // app lives outside the active project must still resolve.
  async list() {
    return allPages<FaableApp>(next => this.listApps({ pageSize: 200, next }, null))
  }

  // One page of apps, scoped to `project` (default: the active project).
  // `null` = unscoped. The api filters by the header, so an admin session
  // doesn't page through the whole platform.
  async listApps(params: PageParams, project: string | null = this.project ?? null) {
    return data(
      this.client.get<Page<FaableApp>>(`/app`, {
        params: page_params(params),
        ...(project ? { headers: projectHeader(project) } : {})
      })
    )
  }

  // Projects the caller belongs to (an admin session sees all of them).
  // `q` searches name/description/slug; `user_id` keeps the ones they own.
  async listProjects(params: PageParams & { q?: string; user_id?: string }) {
    const { q, user_id, ...page } = params
    return data(
      this.client.get<Page<FaableProject>>(`/project`, {
        params: { ...page_params(page), ...(q ? { q } : {}), ...(user_id ? { user_id } : {}) }
      })
    )
  }

  async getProject(project_id: string) {
    return data(this.client.get<FaableProject>(`/project/${project_id}`))
  }

  // The Faable Auth tenants of a project. Membership-checked by the api.
  async listProjectAuthAccounts(project_id: string, params: PageParams = {}) {
    return data(
      this.client.get<Page<FaableAuthAccount>>(
        `/project/${project_id}/auth-accounts`,
        { params: page_params(params) }
      )
    )
  }

  async getBySlug(slug: string) {
    return data(this.client.get<FaableApp>(`/app/slug/${slug}`))
  }

  async getApp(app_id: string) {
    return data(this.client.get<FaableApp>(`/app/${app_id}`))
  }

  // `image`/`type` are optional to support the failure path: a failed build
  // is recorded as a deployment without an image (and without `type`, which
  // would otherwise rewrite the app's runtime_strategy server-side).
  // `source` is the remote-build path (v2): content-addressed manifest +
  // serialized BuildPlan; the platform builds and completes the image.
  async createDeployment(params: {
    app_id: string
    type?: string
    image?: string
    source?: {
      manifest: { path: string; sha: string; size: number; mode?: number }[]
      plan?: unknown
    }
    release?: string
    github_commit?: string
    github_ref?: string
    github_actor?: string
    github_commit_message?: string
  }) {
    return data(this.client.post<{ id: string }>(`/deployment`, params))
  }

  // Remote builds: diff the source manifest against the CAS. Returns
  // presigned PUTs (sha-pinned by signature) for the missing blobs only.
  async uploadMissing(
    app_id: string,
    files: { path: string; sha: string; size: number }[]
  ) {
    return data(
      this.client.post<{
        uploads: { sha: string; url: string; headers: Record<string, string> }[]
      }>(
        `/upload/missing`,
        {
          app_id,
          files: files.map(({ path, sha, size }) => ({ path, sha, size }))
        },
        { timeout: 60_000 }
      )
    )
  }

  // Remote builds: read the build output the builder attaches to the
  // deployment (same endpoint the CLI writes to in local builds).
  async getDeploymentLogs(deployment_id: string) {
    return data(
      this.client.get<{ content: string; truncated: boolean; size: number }>(
        `/deployment/${deployment_id}/logs`
      )
    )
  }

  // Phase transitions the CLI owns (BUILDING when the build starts,
  // BUILD_ERROR on a failed build). Runtime phases stay controller-territory.
  async updateDeploymentStatus(
    deployment_id: string,
    status: { phase: string }
  ) {
    return data(this.client.post(`/status/${deployment_id}`, status))
  }

  // Complete a create-first deployment with the built image (write-once
  // server-side). Setting the image is what makes the controller claim the
  // deployment and materialize it.
  async completeDeployment(deployment_id: string, image: string) {
    return data(
      this.client.post<{ id: string }>(`/deployment/${deployment_id}`, {
        image
      })
    )
  }

  // Fetch a deployment with its runtime status, so the deploy command can
  // watch for a terminal failure (ERROR/BUILD_ERROR + reason) while polling
  // for promotion — and fail the run fast instead of timing out green.
  async getDeployment(deployment_id: string) {
    return data(
      this.client.get<FaableDeployment>(`/deployment/${deployment_id}`)
    )
  }

  // Build payload of a deployment (runnable descriptor: runtime, profile,
  // size, checksum). Authorized by the caller's access to the parent
  // deployment, so no team header is needed — same posture as getDeployment.
  async getArtifact(artifact_id: string) {
    return data(this.client.get<FaableArtifact>(`/artifact/${artifact_id}`))
  }

  // Attach the captured build/deploy output to a deployment. The base client
  // timeout (10s) is too short for a multi-MB body on a slow uplink.
  async uploadDeploymentLogs(
    deployment_id: string,
    body: { content: string; truncated?: boolean }
  ) {
    return data(
      this.client.post<{ id: string; truncated: boolean; size: number }>(
        `/deployment/${deployment_id}/logs`,
        body,
        { timeout: 60_000, maxBodyLength: Infinity, maxContentLength: Infinity }
      )
    )
  }

  async getAppSecrets(app_id: string) {
    return firstPage(data(this.client.get<Page<Secret>>(`/secret/${app_id}`)))
  }

  // Replace the app's whole secret set (the endpoint deletes and recreates).
  // This is the only mutation path that triggers an immediate restart of the
  // app; the per-secret upsert/delete endpoints are not used by the CLI.
  // The endpoint stamps the created secrets with the team from the request
  // context, which a CLI user token does not carry — pass the app's team
  // (from getApp) so it travels as the `x-faable-project` header.
  async createSecretsBatch(
    context_id: string,
    team: string,
    secrets: { name: string; value: string }[]
  ) {
    return data(
      this.client.post<Secret[]>(
        `/secret/createbatch`,
        { context_id, secrets },
        { headers: projectHeader(team) }
      )
    )
  }

  async updateApp(
    app_id: string,
    params: Partial<FaableApp> & { github_repo?: string }
  ) {
    return data(this.client.post<FaableApp>(`/app/${app_id}`, params))
  }

  // Team pinned via header: the api answers 400 team_required without it
  // (it needs the project to check the plan and the repository guard).
  async linkRepository(
    app_id: string,
    params: { repository: string; github_branch?: string },
    team: string
  ) {
    return data(
      this.client.post<FaableApp>(`/app/${app_id}/link-repository`, params, {
        headers: projectHeader(team)
      })
    )
  }

  // Organizations/accounts where the Faable GitHub App is installed.
  async listGithubInstallations() {
    return data(
      this.client.get<{ installations: GithubInstallation[] }>(
        `/github/installations`
      )
    ).then(res => res.installations)
  }

  // Top repositories for a single installation (org), optionally filtered.
  async listGithubRepos(
    installation_id: number,
    params: { q?: string; limit?: number } = {}
  ) {
    return data(
      this.client.get<{ repositories: GithubRepo[] }>(
        `/github/installations/${installation_id}/repositories`,
        { params }
      )
    ).then(res => res.repositories)
  }

  async getMe() {
    return data(this.client.get<{ email: string; id: string }>(`/auth/me`))
  }

  // Runtime logs of the app (Loki-backed; last 24h, up to 200 lines, newest
  // first). Optionally scoped to one deployment.
  async getAppLogs(app_id: string, params: { deployment_id?: string } = {}) {
    return data(
      this.client.get<AppLogLine[]>(`/app/${app_id}/logs`, { params })
    )
  }

  // Deployments of an app, newest first (the API's list index sorts
  // createdAt desc). Team pinned via header — same reason as domains.
  async listDeployments(app_id: string, team: string) {
    return firstPage(this.listDeploymentsPage(app_id, team))
  }

  async listDeploymentsPage(app_id: string, team: string, params: PageParams = {}) {
    return data(
      this.client.get<Page<FaableDeployment>>(`/deployment`, {
        params: { app_id, ...page_params(params) },
        headers: projectHeader(team)
      })
    )
  }

  // Build and deploy the current head of the deploy branch server-side —
  // the same path a push webhook takes, same-commit dedupe included.
  async deployNow(app_id: string, team: string) {
    return data(
      // deployment_id: the build this call started (api ≥ the release that
      // added it; absent from older ones).
      this.client.post<{
        status: 'created'
        commit: string
        branch: string
        deployment_id?: string
      }>(`/app/${app_id}/deploy`, undefined, { headers: projectHeader(team) })
    )
  }

  // Rebuild a failed deployment from its recorded source (CAS manifest or
  // git ref). The API enforces the guards: failed phase only, never older
  // than what production serves.
  async redeployDeployment(deployment_id: string, team: string) {
    return data(
      this.client.post<FaableDeployment>(
        `/deployment/${deployment_id}/redeploy`,
        undefined,
        { headers: projectHeader(team) }
      )
    )
  }

  // Give up on a build still in the pre-handoff window (QUEUED/BUILDING).
  // A route of its own rather than a `{phase: 'CANCELED'}` status write:
  // phase transitions belong to the controller, and the api only lets a user
  // token touch the phases the CLI owns.
  async cancelDeployment(deployment_id: string, team: string) {
    return data(
      this.client.post<FaableDeployment>(
        `/deployment/${deployment_id}/cancel`,
        undefined,
        { headers: projectHeader(team) }
      )
    )
  }

  // Domains are team-scoped rows; a CLI user token carries no default team,
  // so every call pins the app's project via `x-faable-project` (same pattern
  // as createSecretsBatch).
  async listDomains(app_id: string, team: string) {
    return firstPage(this.listDomainsPage(app_id, team))
  }

  async listDomainsPage(app_id: string, team: string, params: PageParams = {}) {
    return data(
      this.client.get<Page<FaableDomain>>(`/domain`, {
        params: { app_id, ...page_params(params) },
        headers: projectHeader(team)
      })
    )
  }

  async createDomain(
    team: string,
    params: { fqdn: string; app_id: string; tls?: boolean }
  ) {
    return data(
      this.client.post<FaableDomain>(`/domain`, params, {
        headers: projectHeader(team)
      })
    )
  }

  async getDomain(domain_id: string, team: string) {
    return data(
      this.client.get<FaableDomain>(`/domain/${domain_id}`, {
        headers: projectHeader(team)
      })
    )
  }

  async deleteDomain(domain_id: string, team: string) {
    return data(
      this.client.delete(`/domain/${domain_id}`, {
        headers: projectHeader(team)
      })
    )
  }

  // ── apps: create, configure, observe ─────────────────────────────────────

  // A bare app in a project; `linkRepository` gives it something to build.
  async createApp(
    project: string,
    params: { name: string; description?: string }
  ) {
    return data(
      this.client.post<FaableApp>(`/app`, params, {
        headers: projectHeader(project)
      })
    )
  }

  async deleteApp(app_id: string, team: string) {
    return data(
      this.client.delete(`/app/${app_id}`, { headers: projectHeader(team) })
    )
  }

  async setDeployBranch(app_id: string, github_branch: string) {
    return data(
      this.client.post<{ github_branch: string }>(
        `/app/${app_id}/deploy-branch`,
        { github_branch }
      )
    )
  }

  // null clears the platform override (faable.json's rootDir applies again).
  async setRootDir(app_id: string, root_dir: string | null) {
    return data(
      this.client.post<FaableApp>(`/app/${app_id}/root-dir`, { root_dir })
    )
  }

  // push: every push deploys · ci: deploys once CI tags a release ·
  // workflow: the repo's own GitHub workflow runs `faable deploy`.
  async setDeployMode(app_id: string, mode: 'push' | 'ci' | 'workflow') {
    return data(
      this.client.post<FaableApp>(`/app/${app_id}/deploy-mode`, { mode })
    )
  }

  // Edge traffic of one app (ClickHouse, trails reality by up to 15 min).
  // from/to are unix seconds.
  async getAppTraffic(
    app_id: string,
    team: string,
    params: { from?: number; to?: number; deployment_id?: string } = {}
  ) {
    return data(
      this.client.get<Record<string, unknown>>(`/app/${app_id}/traffic`, {
        params,
        headers: projectHeader(team)
      })
    )
  }

  // The project's usage this billing period. `traffic: false` keeps it to
  // the database (the Stripe-backed traffic figures are the slow half).
  async getUsageSummary(project: string, params: { traffic?: boolean } = {}) {
    return data(
      this.client.get<Record<string, unknown>>(`/usage/summary`, {
        params,
        headers: projectHeader(project)
      })
    )
  }

  async getDeployQuota(project: string) {
    return data(
      this.client.get<{
        limited: boolean
        over: boolean
        used: number
        limit: number | null
        resets_at: string
        held: number
      }>(`/deploy-quota`, { headers: projectHeader(project) })
    )
  }

  // ── per-app WAF ───────────────────────────────────────────────────────────
  //
  // No `x-faable-project` header on any of these: the routes are scoped by the
  // app in the path (the server reads the project off the App row), and sending
  // a project override would only narrow the lookup.

  async getAppWaf(app_id: string) {
    return data(this.client.get<FaableAppWaf>(`/app/${app_id}/waf`))
  }

  async addAppWafRule(
    app_id: string,
    params: {
      pattern?: string
      user_agent?: string
      query?: string
      action: 'deny' | 'sink'
      description?: string
      force?: boolean
    }
  ) {
    return data(
      this.client.post<FaableAppWaf>(`/app/${app_id}/waf/rules`, params)
    )
  }

  async removeAppWafRule(
    app_id: string,
    params: {
      pattern?: string
      user_agent?: string
      query?: string
      action?: 'deny' | 'sink'
    }
  ) {
    return data(
      this.client.delete<FaableAppWaf>(`/app/${app_id}/waf/rules`, {
        data: params
      })
    )
  }
}
