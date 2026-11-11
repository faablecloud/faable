import { z } from 'zod'
import { version } from '../config'

// The tool catalog of `faable mcp` — catalog v1 of
// arch/deploy/mcp-server-faable.md. Each tool is one CLI command (run_cli.ts);
// this file only says which, with which flags, and what of its JSON the agent
// gets back. Descriptions are written for the model choosing a tool: what the
// task is, not which endpoint answers it.

type Args = Record<string, any>

export interface ToolDef {
  name: string
  title: string
  description: string
  input: z.ZodRawShape
  // The CLI command, without flags — the contract test checks it exists.
  command: string[]
  // The flags for one call (the command and --json are added by the caller).
  flags: (a: Args) => string[]
  stdin?: (a: Args) => string
  // Reversible writes: registered only with `faable mcp --writes`.
  write?: boolean
  // Stdio only, never on the hosted server: works on the user's own disk
  // (uploads a directory), or needs more than the hosted token may do (role
  // writes).
  local_only?: boolean
  // How long the CLI may take (default 120 s): a deploy that waits for its
  // build needs minutes.
  timeout_ms?: number
  // The output carries text a third party wrote (build/runtime logs, commit
  // messages, failure reasons): it goes back wrapped as data (riesgo de
  // inyección del plan).
  untrusted?: boolean
  // What of the CLI's JSON the agent needs; the rest is context it pays for.
  shape?: (data: any, a: Args) => unknown
  // readOnlyHint, destructiveHint and openWorldHint are required, not
  // optional: ChatGPT's app review rejects a tool where any of the three is
  // missing rather than an explicit boolean (and Claude's directory flags it).
  annotations: {
    readOnlyHint: boolean
    destructiveHint: boolean
    idempotentHint?: boolean
    openWorldHint: boolean
  }
  // Arguments for the contract test.
  example: Args
}

const project = z
  .string()
  .optional()
  .describe(
    'Project id, name or slug. Defaults to the active project (`faable project use`).'
  )
const app = z
  .string()
  .describe('App id (app_…), name or slug. Names are looked up in the project.')
const cursor = z
  .string()
  .optional()
  .describe('next_cursor from the previous page, to continue a listing')

const scope = (a: Args) => (a.project ? ['--project', a.project] : [])
const target = (a: Args) => ['--app', a.app, ...scope(a)]
// Domains are the project's: a tool that finds one needs no app.
const optional_app = app
  .optional()
  .describe(
    'App id (app_…), name or slug. Optional: without it, the whole project'
  )
const app_or_project = (a: Args) => (a.app ? target(a) : scope(a))
const opt = (flag: string, value: unknown) =>
  value === undefined || value === null || value === ''
    ? []
    : [flag, String(value)]

// Free text that may start with "-" (an app name is any text): as a separate
// argument yargs reads "--no-deploy" as a flag of its own and the name comes
// out empty. Glued with "=" it can only be the value.
const optText = (flag: string, value: unknown) =>
  value === undefined || value === null || value === ''
    ? []
    : [`${flag}=${String(value)}`]

const READ = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: true
} as const

// A value as a double-quoted .env value, escaping exactly what parse_env
// (src/commands/deploy/secrets/parse_env.ts) unescapes — no more: JSON's
// \b, \f or \uXXXX would arrive as literal text.
export const env_quote = (value: string): string =>
  '"' +
  value.replace(/[\\"\n\r\t]/g, c =>
    c === '\n' ? '\\n' : c === '\r' ? '\\r' : c === '\t' ? '\\t' : '\\' + c
  ) +
  '"'

// A listing page, with each item projected.
const page = (pick: (item: any) => unknown) => (data: any) => ({
  data: (data?.data ?? []).map(pick),
  has_more: !!data?.has_more,
  next_cursor: data?.next_cursor ?? null
})

const first_line = (text?: string) => (text ? text.split('\n')[0] : undefined)

const deployment_row = (d: any) => ({
  id: d.id,
  phase: d.status?.phase,
  reason: first_line(d.status?.reason),
  commit: d.github_commit?.slice(0, 7),
  message: first_line(d.github_commit_message),
  ref: d.github_ref,
  trigger: d.trigger,
  release: d.release,
  created_at: d.createdAt
})

const app_row = (a: any) => ({
  id: a.id,
  name: a.name,
  slug: a.slug,
  url: a.url ? `https://${a.url}` : undefined,
  phase: a.status?.phase,
  live_deployment: a.status?.deployment ?? null,
  repository: a.repository || null,
  branch: a.github_branch,
  deploy_mode: a.deploy_trigger
})

// ── Faable Auth ─────────────────────────────────────────────────────────────

const tenant = z
  .string()
  .optional()
  .describe(
    "Auth tenant id (account_…). Defaults to the project's tenant (list_auth_tenants when it has several)."
  )
const auth_scope = (a: Args) => [...opt('--account', a.tenant), ...scope(a)]
const user_ref = z.string().describe('User id (user_…) or exact email')
const time = z.string().regex(/^(\d+[mhd]|\d{4}-\d{2}-\d{2}|\d{10,})$/)
const limit_flag = (a: Args, d = 50) => ['--limit', String(a.limit ?? d)]
const limit = z
  .number()
  .int()
  .min(1)
  .max(200)
  .optional()
  .describe('How many (default 50)')

const user_row = (u: any) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  email_verified: u.email_verified,
  suspended: !!u.suspended,
  suspended_reason: u.suspended ? u.suspended_reason : undefined,
  last_login: u.last_login ?? null,
  logins_count: u.logins_count,
  created_at: u.createdAt
})

const log_user = (l: any) =>
  typeof l.user === 'string'
    ? { user_id: l.user }
    : l.user
      ? { user_id: l.user.id, email: l.user.email, name: l.user.name }
      : {}

const AUTH_READ = { ...READ } as const

// ── Auth APIs: the settings create_auth_api and update_auth_api take ────────
// Same names as the API fields; the CLI flag is the field in kebab case
// (src/commands/auth/apis/settings.ts).
const API_BOOLEANS = [
  'allow_offline_access',
  'skip_consent',
  'include_roles_in_access_token',
  'include_teams_in_access_token',
  'include_roles_in_id_token',
  'include_teams_in_id_token',
  'enforce_policies'
] as const
const api_settings_input = {
  token_lifetime: z
    .number()
    .int()
    .min(60)
    .max(60 * 60 * 24 * 30)
    .optional()
    .describe(
      'Access token lifetime in seconds, 60–2592000 (30 days). A new API gets 86400'
    ),
  description: z.string().max(512).optional(),
  rbac: z
    .boolean()
    .optional()
    .describe(
      'User tokens carry only the requested permissions their roles grant. On create it also sets the access_token_authz dialect'
    ),
  allow_offline_access: z
    .boolean()
    .optional()
    .describe('Clients may request offline_access and get a refresh_token'),
  skip_consent: z
    .boolean()
    .optional()
    .describe('Skip the consent screen for first-party clients'),
  include_roles_in_access_token: z
    .boolean()
    .optional()
    .describe("Access tokens carry a `roles` claim with the user's role names"),
  include_teams_in_access_token: z
    .boolean()
    .optional()
    .describe("Access tokens carry a `teams` claim with the user's team slugs"),
  include_roles_in_id_token: z
    .boolean()
    .optional()
    .describe(
      'id_tokens issued with an access token for this API carry `roles`'
    ),
  include_teams_in_id_token: z
    .boolean()
    .optional()
    .describe(
      'id_tokens issued with an access token for this API carry `teams`'
    ),
  enforce_policies: z
    .boolean()
    .optional()
    .describe(
      'Filter requested scopes against the permission catalog at issuance'
    )
}
const api_settings_flags = (a: Args) => [
  ...opt('--token-lifetime', a.token_lifetime),
  ...optText('--description', a.description),
  ...(a.rbac === undefined ? [] : [a.rbac ? '--rbac' : '--no-rbac']),
  ...API_BOOLEANS.flatMap(f => {
    const flag = f.replace(/_/g, '-')
    return a[f] === undefined ? [] : [a[f] ? `--${flag}` : `--no-${flag}`]
  })
]
const api_detail = (a: any) => ({
  id: a.id,
  name: a.name,
  identifier: a.identifier,
  description: a.description,
  token_lifetime: a.token_lifetime,
  token_dialect: a.token_dialect,
  rbac: !!a.rbac,
  ...Object.fromEntries(API_BOOLEANS.map(f => [f, !!a[f]])),
  permissions: (a.permissions ?? []).map((p: any) => p.value)
})

// Which product a tool works on — /tools.json and the landing group by it.
export const product_of = (
  tool: Pick<ToolDef, 'command'>
): 'auth' | 'deploy' => (tool.command[0] === 'auth' ? 'auth' : 'deploy')
const AUTH_WRITE = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true
} as const

export const TOOLS: ToolDef[] = [
  {
    name: 'whoami',
    title: 'Who is logged in',
    description:
      'The Faable account this server acts as, the active project and its Auth tenant, and `server_version` — the Faable CLI version this MCP server runs. Use it first when unsure whether the user is logged in or which project is active, or to check which version is serving.',
    input: {},
    command: ['whoami'],
    flags: () => [],
    shape: (d: any) => ({ ...d, server_version: version }),
    annotations: READ,
    example: {}
  },
  {
    name: 'list_projects',
    title: 'List projects',
    description:
      "The user's Faable projects. Apps, domains and Auth tenants live in a project; pass its id as `project` to the other tools.",
    input: {
      query: z
        .string()
        .optional()
        .describe('Search by name, slug or description'),
      cursor
    },
    command: ['project', 'list'],
    flags: a => [
      '--limit',
      '50',
      ...opt('-q', a.query),
      ...opt('--starting-after', a.cursor)
    ],
    shape: page((p: any) => ({ id: p.id, name: p.name, slug: p.slug })),
    annotations: READ,
    example: { query: 'web', cursor: 'abc' }
  },
  {
    name: 'list_apps',
    title: 'List apps',
    description:
      'The apps of a project, with their live phase, URL and linked repository. Start here to find the app the user means.',
    input: { project, cursor },
    command: ['deploy', 'apps', 'list'],
    flags: a => [
      '--limit',
      '100',
      ...scope(a),
      ...opt('--starting-after', a.cursor)
    ],
    shape: page(app_row),
    annotations: READ,
    example: { project: 'p', cursor: 'abc' }
  },
  {
    name: 'get_app',
    title: 'Get an app',
    description:
      "One app: phase, URL, repository, deploy branch and mode, detected stack, and its newest deployment (which may have failed while an older one keeps serving). Use it to answer 'is my app up?' or 'what is deployed?'.",
    input: { app, project },
    command: ['deploy', 'apps', 'get'],
    flags: target,
    untrusted: true,
    shape: (a: any) => ({
      ...app_row(a),
      root_dir: a.root_dir ?? null,
      detected: a.detected,
      latest_deployment: a.latest_deployment
        ? deployment_row(a.latest_deployment)
        : null
    }),
    annotations: READ,
    example: { app: 'web', project: 'p' }
  },
  {
    name: 'list_deployments',
    title: 'List deployments',
    description:
      "Recent deployments of an app, newest first, with phase, commit and the first line of any failure reason. Use it to find the deployment behind 'my last deploy failed'.",
    input: {
      app,
      project,
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe('How many (default 10)'),
      cursor
    },
    command: ['deploy', 'deployments'],
    flags: a => [
      ...target(a),
      '--limit',
      String(a.limit ?? 10),
      ...opt('--starting-after', a.cursor)
    ],
    untrusted: true,
    shape: page(deployment_row),
    annotations: READ,
    example: { app: 'web', limit: 5, cursor: 'abc' }
  },
  {
    name: 'get_deployment',
    title: 'Get a deployment',
    description:
      "Everything recorded about one deployment: phase, commit, detected stack, the runnable artifact, the FULL failure reason and, when it failed, `fault` — whether it is the user's to fix (`user`) or Faable's (`platform`). Without `deployment`, the newest one of the app.",
    input: {
      app,
      project,
      deployment: z.string().optional().describe('Deployment id (deployment_…)')
    },
    command: ['deploy', 'inspect'],
    flags: a => [...(a.deployment ? [a.deployment] : []), ...target(a)],
    untrusted: true,
    shape: (d: any) => ({
      ...deployment_row(d),
      reason: d.status?.reason,
      app_id: d.app_id,
      detected: d.detected,
      redeploy_of: d.redeploy_of,
      build_ms: d.build_ms,
      // user = the code/config/repository; platform = Faable's side.
      fault: d.fault ?? null,
      artifact: d.artifact?.artifact
        ? {
            profile: d.artifact.artifact.profile,
            runtime: d.artifact.artifact.runtime,
            start_command: d.artifact.artifact.start_command,
            size: d.artifact.artifact.size
          }
        : null
    }),
    annotations: READ,
    example: { app: 'web', deployment: 'deployment_1' }
  },
  {
    name: 'get_build_logs',
    title: 'Read build logs',
    description:
      'The build output of a deployment — the first thing to read when a deploy failed and the user asks why. The cause is usually at the end. Without `deployment`, the newest one that was not cancelled.',
    input: {
      app,
      project,
      deployment: z
        .string()
        .optional()
        .describe('Deployment id (deployment_…)'),
      tail: z
        .number()
        .int()
        .min(1)
        .max(2000)
        .optional()
        .describe('Last N lines (default 200)')
    },
    command: ['deploy', 'logs'],
    flags: a => [
      '--build',
      ...opt('--deployment', a.deployment),
      '--tail',
      String(a.tail ?? 200),
      ...target(a)
    ],
    untrusted: true,
    annotations: READ,
    example: { app: 'web', deployment: 'deployment_1', tail: 100 }
  },
  {
    name: 'get_runtime_logs',
    title: 'Read runtime logs',
    description:
      'What the running app printed (last 24 hours, up to 200 lines). Use it when the app is up but misbehaving, or crashes after starting. A deployment retired more than a day ago has none — read its build logs instead.',
    input: {
      app,
      project,
      deployment: z.string().optional().describe('Only this deployment'),
      tail: z.number().int().min(1).max(200).optional().describe('Last N lines')
    },
    command: ['deploy', 'logs'],
    flags: a => [
      ...opt('--deployment', a.deployment),
      ...opt('--tail', a.tail),
      ...target(a)
    ],
    untrusted: true,
    shape: (d: any) => d?.data ?? [],
    annotations: READ,
    example: { app: 'web', deployment: 'deployment_1', tail: 50 }
  },
  {
    name: 'get_app_traffic',
    title: 'Read app traffic',
    description:
      'Requests the app served: status codes, busiest paths and failing paths. Trails reality by up to 15 minutes.',
    input: {
      app,
      project,
      since: z
        .string()
        .regex(/^\d+[mhd]$/)
        .optional()
        .describe('How far back: 30m, 24h, 7d (default 24h)'),
      deployment: z
        .string()
        .optional()
        .describe('Only what this deployment served')
    },
    command: ['deploy', 'traffic'],
    flags: a => [
      ...opt('--since', a.since),
      ...opt('--deployment', a.deployment),
      ...target(a)
    ],
    untrusted: true,
    shape: (t: any) => ({
      range: t.range,
      status_codes: t.status_codes,
      top_endpoints: t.top_endpoints?.slice(0, 15),
      error_endpoints: t.error_endpoints?.slice(0, 15),
      degraded: t.degraded
    }),
    annotations: READ,
    example: { app: 'web', since: '7d', deployment: 'deployment_1' }
  },
  {
    name: 'get_usage',
    title: 'Read project usage',
    description:
      "This billing period's usage of a project: plan, apps, domains, deployments and egress.",
    input: { project },
    command: ['deploy', 'usage'],
    flags: scope,
    annotations: READ,
    example: { project: 'p' }
  },
  {
    name: 'get_quota',
    title: 'Read deploy quota',
    description:
      "Today's deploy allowance of a project and the builds held waiting for it. Use it when a deploy did not start: a held build is waiting, not failing.",
    input: { project },
    command: ['deploy', 'quota'],
    flags: scope,
    annotations: READ,
    example: { project: 'p' }
  },
  {
    name: 'list_domains',
    title: 'List custom domains',
    description:
      'Custom domains of an app and whether their DNS is verified. Without `app`, every domain of the project with the app it serves: `app_id: null` is a domain linked to no app (its app was deleted), which answers DOMAIN_NOT_LINKED until attach_domain links it. `redirect` names the domain it sends every request to (the www half of a pair, or an alias); null when it serves its app.',
    input: { app: optional_app, project },
    command: ['deploy', 'domains', 'list'],
    flags: app_or_project,
    shape: page((d: any) => ({
      id: d.id,
      fqdn: d.fqdn,
      app_id: d.app_id ?? null,
      verified: d.verified,
      tls: d.tls,
      redirect: d.redirect ?? null,
      dns_message: d.status?.dns_message
    })),
    annotations: READ,
    example: { app: 'web' }
  },
  {
    name: 'check_domain',
    title: 'Check a domain',
    description:
      'DNS diagnostic of one custom domain: the CNAME it expects, what DNS answers today, and why it is not verified yet. `prevalidation_cname.ready` says whether the optional `_acme-challenge` record is in place, so the certificate is issued without waiting for the CNAME; `status.tls_state` is `ok` once the edge serves a valid certificate for the domain (`status.tls_expires_at`).',
    input: {
      app: optional_app,
      project,
      fqdn: z.string().describe('The domain, e.g. www.example.com')
    },
    command: ['deploy', 'domains', 'check'],
    flags: a => [a.fqdn, ...app_or_project(a)],
    shape: (d: any) => ({
      fqdn: d.fqdn,
      app_id: d.app_id ?? null,
      verified: d.verified,
      redirect: d.redirect ?? null,
      expected_cname: d.expected_cname,
      observed: d.status?.dns_observed ?? [],
      diagnostic: d.status?.dns_message,
      checked_at: d.status?.dns_checked_at
    }),
    annotations: READ,
    example: { app: 'web', fqdn: 'www.example.com' }
  },
  {
    name: 'list_secrets',
    title: 'List secret names',
    description:
      'The environment variables set on an app. Names only — values are masked and this tool can never reveal them. Use it to check whether a variable the app needs is set.',
    input: { app, project },
    command: ['deploy', 'secrets', 'list'],
    // Never --show.
    flags: target,
    shape: page((s: any) => ({
      name: s.name,
      inherited_from_project: s.related_model === 'profile'
    })),
    annotations: READ,
    example: { app: 'web' }
  },
  // ── Faable Auth: the users of the project's Auth tenant ───────────────────
  {
    name: 'list_auth_tenants',
    title: 'List Auth tenants',
    description:
      'The Faable Auth tenants (user directories) of a project. Most projects have one and every Auth tool uses it; with several, pass the right one as `tenant`.',
    input: { project },
    command: ['auth', 'accounts', 'list'],
    flags: scope,
    shape: page((a: any) => ({ id: a.id, name: a.name, domain: a.domain })),
    annotations: AUTH_READ,
    example: { project: 'p' }
  },
  {
    name: 'list_auth_logins',
    title: 'Recent logins',
    description:
      "Who logged in to the app's Faable Auth, newest first: one row per login with the user's email, when, from which IP and with which method. Answers 'who logged in recently?' or 'did X log in today?'. For 'how many', use count_auth_users.",
    input: {
      since: time
        .optional()
        .describe('How far back: 30m, 24h, 7d, a date (default 24h)'),
      status: z
        .enum(['success', 'failed'])
        .optional()
        .describe('Only successful or only failed attempts (default: both)'),
      limit,
      tenant,
      project
    },
    command: ['auth', 'logs', 'list'],
    flags: a => [
      '--type',
      'user.login',
      '--since',
      a.since ?? '24h',
      ...opt('--status', a.status),
      '--expand-user',
      ...limit_flag(a),
      ...auth_scope(a)
    ],
    untrusted: true,
    shape: (d: any) => ({
      logins: (d?.data ?? []).map((l: any) => ({
        at: l.createdAt,
        ...log_user(l),
        status: l.status,
        ip: l.data?.ip,
        connection_type: l.data?.connection_type,
        client_id: l.data?.client_id
      })),
      has_more: !!d?.has_more
    }),
    annotations: AUTH_READ,
    example: { since: '7d', status: 'success', limit: 20, tenant: 'account_1' }
  },
  {
    name: 'count_auth_users',
    title: 'Count users',
    description:
      "How many users of the Auth tenant match: logged in since a time ('how many users logged in today / this week'), signed up since a time ('how many sign-ups this month'), suspended, or all of them. Counts users, not logins.",
    input: {
      last_login_since: time
        .optional()
        .describe('Logged in at or after: 24h, 7d, a date'),
      created_since: time
        .optional()
        .describe('Signed up at or after: 24h, 7d, a date'),
      created_until: time.optional().describe('Signed up at or before'),
      suspended: z.boolean().optional(),
      tenant,
      project
    },
    command: ['auth', 'users', 'list'],
    flags: a => [
      '--count',
      ...opt('--last-login-since', a.last_login_since),
      ...opt('--created-since', a.created_since),
      ...opt('--created-until', a.created_until),
      ...(a.suspended === undefined
        ? []
        : [a.suspended ? '--suspended' : '--no-suspended']),
      ...auth_scope(a)
    ],
    annotations: AUTH_READ,
    example: { last_login_since: '24h', created_since: '7d', suspended: false }
  },
  {
    name: 'list_auth_users',
    title: 'List users',
    description:
      'Users of the Auth tenant. Find one by email or text, list the suspended ones, or sort: `-last_login` (most recent login first), `last_login` (longest without logging in), `-logins_count` (most active), `-createdAt` (newest sign-ups, the default). Sorting by last_login leaves out users who never logged in.',
    input: {
      search: z.string().optional().describe('Text in name, email or phone'),
      email: z.string().optional().describe('Exact email'),
      suspended: z.boolean().optional(),
      sort: z
        .enum([
          '-last_login',
          'last_login',
          '-logins_count',
          '-createdAt',
          'createdAt'
        ])
        .optional(),
      last_login_since: time
        .optional()
        .describe('Logged in at or after: 24h, 7d, a date'),
      created_since: time.optional().describe('Signed up at or after'),
      limit,
      cursor,
      tenant,
      project
    },
    command: ['auth', 'users', 'list'],
    flags: a => [
      ...opt('-q', a.search),
      ...opt('--email', a.email),
      ...(a.suspended === undefined
        ? []
        : [a.suspended ? '--suspended' : '--no-suspended']),
      // `--sort=-x`: as two words yargs would read `-last_login` as flags.
      ...(a.sort ? [`--sort=${a.sort}`] : []),
      ...opt('--last-login-since', a.last_login_since),
      ...opt('--created-since', a.created_since),
      ...limit_flag(a),
      ...opt('--starting-after', a.cursor),
      ...auth_scope(a)
    ],
    // Names and emails are typed by the end users themselves.
    untrusted: true,
    shape: page(user_row),
    annotations: AUTH_READ,
    example: {
      search: 'ana',
      suspended: false,
      created_since: '30d',
      email: 'ana@example.com',
      sort: '-last_login',
      last_login_since: '7d',
      limit: 10,
      cursor: 'c'
    }
  },
  {
    name: 'get_auth_user',
    title: 'Get a user',
    description:
      "One user of the Auth tenant by id or email: profile, verification, suspension (and why), last login and login count, the social identities they sign in with, and `credentials` — the email/username they actually TYPE at the database (password) login. That login identifier can differ from the profile `email`; when it does, a login failing with the profile email is the bug. Use it to confirm who a user is before suspending them, or to see why they can't log in (together with list_auth_logs).",
    input: { user: user_ref, tenant, project },
    command: ['auth', 'users', 'get'],
    flags: a => [a.user, ...auth_scope(a)],
    untrusted: true,
    shape: (u: any) => ({
      ...user_row(u),
      phone: u.phone,
      last_ip: u.last_ip,
      // `auth users get --json` rows: { connection, connection_name,
      // identity_id, profile_data } — the provider account behind the user.
      identities: (u.identities ?? []).map((i: any) => ({
        connection: i.connection_name ?? i.connection,
        identity_id: i.identity_id,
        login: i.profile_data?.login,
        profile_url: i.profile_data?.html_url,
        account_created_at: i.profile_data?.created_at,
        provider_email: i.profile_data?.email
      })),
      credentials: (u.credentials ?? []).map((c: any) => ({
        connection: c.connection_name ?? c.connection,
        identifier: c.email ?? c.username
      }))
    }),
    annotations: AUTH_READ,
    example: { user: 'ana@example.com' }
  },
  {
    name: 'diagnose_auth_login',
    title: 'Diagnose a login identifier',
    description:
      "Given the exact email or username a person is trying to log in with, explain in one call whether it signs anyone in. `logs_in: true` → it is a real login identifier (so a failure is the password or a suspension, not the identifier). `logs_in: false` with `profile_email_only` populated → a user has that address as their PROFILE email but logs in with a different identifier (the usual trap: the address they were given is not the one on the account); `login_identifiers` lists what they must actually type. `suggestions` offers near matches when nothing matched. Use this first for 'X cannot log in'.",
    input: {
      identifier: z
        .string()
        .describe('The email or username the person is trying to log in with'),
      tenant,
      project
    },
    command: ['auth', 'users', 'diagnose'],
    flags: a => [a.identifier, ...auth_scope(a)],
    untrusted: true,
    annotations: AUTH_READ,
    example: { identifier: 'ana@personal.com' }
  },
  {
    name: 'list_auth_logs',
    title: 'Read the Auth audit log',
    description:
      "The Auth tenant's audit log, newest first: logins, failed logins (`status: failed`), sign-ups, password resets, admin changes (`type` prefix `admin.user`). Filter by user to answer 'why can't X log in?' — the failed attempts say why. On a failed login no user resolves, so each row also carries `attempted_identifier`: the email/username the person actually typed (diagnose_auth_login turns that into the account they should be using).",
    input: {
      email: z
        .string()
        .optional()
        .describe("Only this user's events (exact email)"),
      user: z.string().optional().describe('Only this user id (user_…)'),
      type: z
        .string()
        .optional()
        .describe('Exact event type, e.g. user.login, user.signup'),
      origin: z.string().optional().describe('Type prefix, e.g. oauth, admin'),
      status: z.enum(['success', 'failed', 'skipped', 'info']).optional(),
      since: time.optional().describe('30m, 24h, 7d or a date (default 7d)'),
      until: time.optional(),
      limit,
      tenant,
      project
    },
    command: ['auth', 'logs', 'list'],
    flags: a => [
      ...opt('--email', a.email),
      ...opt('--user', a.user),
      ...opt('--type', a.type),
      ...opt('--origin', a.origin),
      ...opt('--status', a.status),
      '--since',
      a.since ?? '7d',
      ...opt('--until', a.until),
      '--expand-user',
      ...limit_flag(a),
      ...auth_scope(a)
    ],
    untrusted: true,
    shape: (d: any) => ({
      events: (d?.data ?? []).map((l: any) => {
        const resolved = log_user(l)
        // The identifier the person TYPED. On a failed login no user resolves,
        // so this is the only record of who tried and with what address —
        // surface it when it adds something the resolved user does not.
        const tried = l.data?.email
        return {
          at: l.createdAt,
          type: l.type,
          status: l.status,
          ...resolved,
          ...(tried && tried !== (resolved as { email?: string }).email
            ? { attempted_identifier: tried }
            : {}),
          message: l.message,
          ip: l.data?.ip
        }
      }),
      has_more: !!d?.has_more
    }),
    annotations: AUTH_READ,
    example: {
      email: 'ana@example.com',
      type: 'user.login',
      origin: 'oauth',
      status: 'failed',
      since: '24h',
      until: '2026-10-05',
      limit: 20
    }
  },
  {
    name: 'list_auth_sessions',
    title: "List a user's sessions",
    description:
      'The devices a user is signed in on (one row per login session): IP, device, last activity and whether it is still active.',
    input: {
      user: user_ref,
      active: z
        .boolean()
        .optional()
        .describe('Only active sessions (default true)'),
      tenant,
      project
    },
    command: ['auth', 'sessions', 'list'],
    flags: a => [
      '--user',
      a.user,
      ...(a.active === false ? [] : ['--active']),
      '--limit',
      '50',
      ...auth_scope(a)
    ],
    untrusted: true,
    shape: page((s: any) => ({
      id: s.id,
      status: s.status,
      ip: s.ip,
      device: s.device_name ?? s.user_agent,
      last_seen_at: s.last_seen_at,
      created_at: s.createdAt
    })),
    annotations: AUTH_READ,
    example: { user: 'ana@example.com', active: true }
  },
  {
    name: 'list_auth_connections',
    title: 'List login methods',
    description:
      'How users can log in to the Auth tenant: social providers (Google, GitHub…), passwordless (email or SMS codes) and username/password, and which are enabled.',
    input: { tenant, project },
    command: ['auth', 'connections', 'list'],
    flags: a => ['--limit', '100', ...auth_scope(a)],
    annotations: AUTH_READ,
    example: { tenant: 'account_1' }
  },
  {
    name: 'list_auth_clients',
    title: 'List Auth applications',
    description:
      'The applications (OAuth clients) of the Auth tenant: web apps, SPAs, native apps and machine-to-machine clients.',
    input: { search: z.string().optional(), tenant, project },
    command: ['auth', 'clients', 'list'],
    flags: a => [...opt('-q', a.search), '--limit', '100', ...auth_scope(a)],
    shape: page((c: any) => ({
      id: c.id,
      client_id: c.client_id,
      name: c.name,
      application_type: c.application_type,
      grant_types: c.grant_types
    })),
    annotations: AUTH_READ,
    example: { search: 'web', tenant: 'account_1' }
  },
  {
    name: 'list_github_repos',
    title: 'List deployable GitHub repositories',
    description:
      'The GitHub repositories Faable can deploy: those the Faable GitHub App is installed on. Use it before create_app to find the repository the user means. When the app is not installed (or the repository is missing), give the user `install_url` — installing it is a step in their browser.',
    input: {
      query: z.string().optional().describe('Filter by repository name'),
      limit: z.number().int().min(1).max(100).optional()
    },
    command: ['deploy', 'github', 'repos'],
    flags: a => [...opt('-q', a.query), ...opt('--limit', a.limit)],
    annotations: READ,
    example: { query: 'web', limit: 10 }
  },
  {
    name: 'deploy_app',
    title: 'Deploy an app',
    description:
      "Build and deploy the latest commit of the app's deploy branch on Faable's servers — the same as a git push. Nothing is uploaded from this machine. With `wait`, returns once it is live (with the URL) or failed (with the reason and whether it is the user's code or Faable's); without it, returns the deployment id at once. Only for apps with push-to-deploy.",
    input: {
      app,
      project,
      wait: z
        .boolean()
        .optional()
        .describe('Wait until live or failed, up to 5 minutes (default false)')
    },
    command: ['deploy', 'trigger'],
    flags: a => [
      ...target(a),
      ...(a.wait ? ['--wait', '--timeout', '300'] : [])
    ],
    timeout_ms: 330_000,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true
    },
    example: { app: 'web' }
  },

  // ── Faable Auth: roles and API permissions (RBAC) ─────────────────────────
  {
    name: 'list_auth_roles',
    title: 'List roles',
    description:
      'Roles of the Auth tenant and how many API permissions each grants. A role assigned to a user gives them its permissions in tokens for APIs with RBAC on; team roles grant none. Use get_auth_role for what one role grants and who holds it.',
    input: { limit, cursor, tenant, project },
    command: ['auth', 'roles', 'list'],
    flags: a => [
      ...limit_flag(a),
      ...opt('--starting-after', a.cursor),
      ...auth_scope(a)
    ],
    shape: page((r: any) => ({
      id: r.id,
      name: r.name,
      description: r.description || undefined,
      permissions: r.permissions?.length ?? 0
    })),
    annotations: AUTH_READ,
    example: { limit: 10, cursor: 'c' }
  },
  {
    name: 'get_auth_role',
    title: 'Get a role',
    description:
      'One role of the Auth tenant, by id or exact name: the API permissions it grants (with their API) and the users it is assigned to.',
    input: {
      role: z.string().describe('Role id (role_…) or exact name'),
      tenant,
      project
    },
    command: ['auth', 'roles', 'get'],
    flags: a => [a.role, ...auth_scope(a)],
    untrusted: true,
    shape: (r: any) => ({
      id: r.id,
      name: r.name,
      description: r.description || undefined,
      permissions: (r.permissions ?? []).map((p: any) => ({
        value: p.value,
        api: p.api_identifier
      })),
      users: r.users
    }),
    annotations: AUTH_READ,
    example: { role: 'support' }
  },
  {
    name: 'get_auth_user_access',
    title: "Get a user's roles and permissions",
    description:
      "What a user of the Auth tenant may do: the roles assigned to them and the API permissions those roles grant, with the role behind each one. Answers 'why can (or can't) X do Y?'. A token carries the permissions the client requests that the user holds, for APIs with RBAC on.",
    input: { user: user_ref, tenant, project },
    command: ['auth', 'users', 'permissions'],
    flags: a => [a.user, ...auth_scope(a)],
    shape: (rows: any) =>
      (Array.isArray(rows) ? rows : []).map((p: any) => ({
        value: p.value,
        api: p.api_identifier,
        roles: (p.roles ?? []).map((r: any) => r.name)
      })),
    annotations: AUTH_READ,
    example: { user: 'ana@example.com' }
  },
  {
    name: 'list_auth_apis',
    title: 'List APIs',
    description:
      'APIs (resource servers) of the Auth tenant: the audience each token is issued for, its token dialect, whether RBAC is on and how many permissions its catalog has.',
    input: { limit, cursor, tenant, project },
    command: ['auth', 'apis', 'list'],
    flags: a => [
      ...limit_flag(a),
      ...opt('--starting-after', a.cursor),
      ...auth_scope(a)
    ],
    shape: page((a: any) => ({
      id: a.id,
      name: a.name,
      identifier: a.identifier,
      token_dialect: a.token_dialect,
      rbac: !!a.rbac,
      permissions: (a.permissions ?? []).map((p: any) => p.value)
    })),
    annotations: AUTH_READ,
    example: { limit: 10, cursor: 'c' }
  },
  // ── Reversible writes: only with `faable mcp --writes` ────────────────────
  {
    name: 'create_app',
    title: 'Create an app from a repository',
    description:
      "Create an app from a GitHub repository in a project, link it and start its first deploy (the dashboard's Create & connect). Needs the Faable GitHub App installed on the repository; if the link fails, the new app is removed and the error says what to fix.",
    input: {
      repo: z.string().describe('GitHub repository, owner/repo'),
      name: z
        .string()
        .optional()
        .describe('App name (defaults to the repository name)'),
      branch: z
        .string()
        .optional()
        .describe('Branch to deploy (defaults to the repository default)'),
      deploy: z
        .boolean()
        .optional()
        .describe('Start the first deploy (default true)'),
      wait: z
        .boolean()
        .optional()
        .describe(
          'Wait for the first deploy to be live (returns the URL) or to fail, up to 5 minutes'
        ),
      project
    },
    command: ['deploy', 'apps', 'create'],
    flags: a => [
      '--repo',
      a.repo,
      ...optText('--name', a.name),
      ...opt('--branch', a.branch),
      ...(a.deploy === false ? ['--no-deploy'] : []),
      ...(a.wait && a.deploy !== false ? ['--wait', '--timeout', '300'] : []),
      ...scope(a)
    ],
    timeout_ms: 330_000,
    write: true,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true
    },
    example: { repo: 'acme/web', name: 'web', branch: 'main', wait: true }
  },
  {
    name: 'redeploy',
    title: 'Retry a failed deployment',
    description:
      'Rebuild a failed deployment from the source it recorded. Without `deployment`, the newest failed one. Refused for code older than what production serves.',
    input: { app, project, deployment: z.string().optional() },
    command: ['deploy', 'redeploy'],
    flags: a => [...(a.deployment ? [a.deployment] : []), ...target(a)],
    write: true,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true
    },
    example: { app: 'web', deployment: 'deployment_1' }
  },
  {
    name: 'cancel_deployment',
    title: 'Cancel a build',
    description:
      'Stop a deployment that is still queued or building. Production keeps serving what it served. Without `deployment`, the one in flight.',
    input: { app, project, deployment: z.string().optional() },
    command: ['deploy', 'cancel'],
    flags: a => [...(a.deployment ? [a.deployment] : []), ...target(a)],
    write: true,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true
    },
    example: { app: 'web', deployment: 'deployment_1' }
  },
  {
    name: 'set_secrets',
    title: 'Set environment variables',
    description:
      'Add or update environment variables of an app. When the app is running, it restarts to apply them (only if a value changed); if its last deployment failed at runtime and nothing is running, Faable redeploys it with the new variables. Returns the names added, updated and unchanged — never the values — and `redeploy`: null when there was nothing to relaunch; otherwise `status` is `started` (follow `deployment_id` with get_deployment), `needs_rebuild` (the last deployment failed to build: retry `failed_deployment_id` with redeploy) or `not_started` (the platform refused the relaunch: retry it with redeploy to see why).',
    input: {
      app,
      project,
      variables: z
        .record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.string())
        .describe('NAME → value')
    },
    command: ['deploy', 'secrets', 'set'],
    // The values go on stdin, as a .env document — never in argv.
    flags: a => ['-f', '-', ...target(a)],
    stdin: a =>
      Object.entries(a.variables as Record<string, string>)
        .map(([k, v]) => `${k}=${env_quote(v)}`)
        .join('\n') + '\n',
    write: true,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true
    },
    example: { app: 'web', variables: { API_URL: 'https://x' } }
  },
  {
    name: 'add_domain',
    title: 'Add a custom domain',
    description:
      'Attach a custom domain to an app. Returns the CNAME record the user must create at their DNS provider; Faable verifies it and issues the certificate on its own. If the domain already serves traffic somewhere else, tell the user to create `prevalidation_cname` (`_acme-challenge.<fqdn>` CNAME) FIRST and switch the main CNAME only once check_domain shows it ready: the certificate then exists before traffic moves, with no TLS gap. If it says the domain is already in this project, use attach_domain instead: adding it again cannot work.',
    input: {
      app,
      project,
      fqdn: z.string().describe('e.g. www.example.com'),
      www: z
        .boolean()
        .optional()
        .describe(
          'Also add the www (or root) counterpart, redirecting to this domain: example.com and www.example.com. Only for a root domain or its www. Both need their DNS record.'
        )
    },
    command: ['deploy', 'domains', 'add'],
    flags: a => [a.fqdn, ...(a.www ? ['--www'] : []), ...target(a)],
    write: true,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true
    },
    example: { app: 'web', fqdn: 'www.example.com' }
  },
  {
    name: 'attach_domain',
    title: 'Link a domain to an app',
    description:
      "Link a custom domain of the project to an app: one left linked to no app (deleting an app leaves its domains in the project, answering DOMAIN_NOT_LINKED), or one moving from another of the project's apps. It keeps its id, its CNAME target and its certificate: nothing changes at the DNS provider. Use it instead of add_domain when add_domain says the domain is already in this project.",
    input: { app, project, fqdn: z.string().describe('e.g. app.example.com') },
    command: ['deploy', 'domains', 'attach'],
    // --yes: the model was asked to move it; the CLI prompt has no one to ask.
    flags: a => [a.fqdn, '--yes', ...target(a)],
    write: true,
    shape: (d: any) => ({ id: d.id, fqdn: d.fqdn, app_id: d.app_id ?? null }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true
    },
    example: { app: 'web', fqdn: 'app.example.com' }
  },
  {
    name: 'set_domain_redirect',
    title: 'Redirect a domain to another',
    description:
      'Make a custom domain send every request to another domain of the same project (GET → 301, other methods → 308, path and query kept), e.g. www.example.com to example.com, or an old name to the new one. `target: null` stops it: the domain serves its app again. The target must be a domain of the project that serves (no chains). Deleting the target later deletes the domains that redirect to it. DNS and certificate do not change.',
    input: {
      app: optional_app,
      project,
      fqdn: z.string().describe('The domain that redirects, e.g. www.example.com'),
      target: z
        .string()
        .nullable()
        .describe('The domain it redirects to, e.g. example.com; null to stop redirecting')
    },
    command: ['deploy', 'domains', 'redirect'],
    flags: a => [
      a.fqdn,
      ...(a.target ? [a.target] : ['--off']),
      ...app_or_project(a)
    ],
    write: true,
    shape: (d: any) => ({
      id: d.id,
      fqdn: d.fqdn,
      app_id: d.app_id ?? null,
      redirect: d.redirect ?? null
    }),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true
    },
    example: { fqdn: 'www.example.com', target: 'example.com' }
  },
  {
    name: 'configure_repo',
    title: 'Configure how an app deploys',
    description:
      'Change the deploy branch, the monorepo root directory ("" clears it) or the deploy mode (push: every push; ci: once CI tags a release; workflow: the repo\'s own GitHub workflow). Applies to the next deploy.',
    input: {
      app,
      project,
      branch: z.string().optional(),
      root_dir: z.string().optional(),
      mode: z.enum(['push', 'ci', 'workflow']).optional()
    },
    command: ['deploy', 'apps', 'set'],
    flags: a => [
      ...opt('--branch', a.branch),
      ...(a.root_dir !== undefined ? ['--root-dir', a.root_dir] : []),
      ...opt('--mode', a.mode),
      ...target(a)
    ],
    write: true,
    shape: app_row,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true
    },
    example: {
      app: 'web',
      branch: 'release',
      root_dir: 'apps/web',
      mode: 'push'
    }
  },
  {
    name: 'link_repo',
    title: 'Link a repository to an app',
    description:
      'Link a GitHub repository to an app that already exists, so a push deploys it (for a new app, create_app does both). What is live keeps serving until the next push — linking starts no deploy. Needs the Faable GitHub App installed on the repository; if not, the error says what to fix.',
    input: {
      app,
      repo: z.string().describe('GitHub repository, owner/repo'),
      branch: z
        .string()
        .optional()
        .describe('Branch to deploy (defaults to the repository default)'),
      project
    },
    command: ['deploy', 'link'],
    flags: a => ['--repo', a.repo, ...opt('--branch', a.branch), ...target(a)],
    write: true,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true
    },
    example: { app: 'web', repo: 'acme/web', branch: 'main' }
  },
  {
    name: 'delete_app',
    title: 'Delete an app',
    description:
      "Delete an app, as the dashboard's Delete app does: its deployments, domains and secrets go with it and its URL stops being served. It cannot be undone — confirm with the user which app (get_app) before calling it. Only on the local server with `faable mcp --writes`.",
    input: { app, project },
    command: ['deploy', 'apps', 'rm'],
    flags: a => ['--yes', ...target(a)],
    write: true,
    // The hosted server promises its users nothing destructive (the consent
    // screen and docs/cli.md say so): deleting stays with whoever runs the
    // MCP on their own machine and passed --writes.
    local_only: true,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true
    },
    example: { app: 'web' }
  },
  {
    name: 'deploy_directory',
    title: 'Deploy a local directory',
    description:
      "Upload a directory of this machine and deploy it (`faable deploy`): Faable builds it and serves it. Any folder works, a git repository or not — in a plain folder its .gitignore files apply, and node_modules and .env files stay out. Pass `app` to deploy to an existing app, or `create` to make a new one with that name: a name already used in the project is refused (deploy to that app instead), and if the deploy cannot start the new app is removed, so a retry never leaves an empty one. Waits until it is live and returns the URL — or why it failed and whether that is the user's code (`user`) or Faable (`platform`). Only on the local server (`npx @faable/faable mcp`). Prefer create_app/deploy_app when the code is on GitHub: a push then deploys on its own.",
    input: {
      workdir: z
        .string()
        .regex(/^\//, 'an absolute path')
        .describe('Absolute path of the directory to deploy'),
      app: z.string().optional().describe('Existing app id, name or slug'),
      create: z
        .string()
        .optional()
        .describe(
          'Name of a NEW app to create and deploy to (instead of `app`)'
        ),
      project
    },
    command: ['deploy', 'launch'],
    flags: a => [
      '--workdir',
      a.workdir,
      ...opt('--app', a.app),
      ...optText('--create', a.create),
      '--yes',
      ...scope(a)
    ],
    write: true,
    local_only: true,
    timeout_ms: 900_000,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true
    },
    example: { workdir: '/home/me/web', app: 'web' }
  },
  // ── Faable Auth writes: only with `faable mcp --writes` ───────────────────
  {
    name: 'create_auth_role',
    title: 'Create a role',
    description:
      'Create a role in the Auth tenant. It grants nothing until you give it permissions with update_auth_role_permissions.',
    input: {
      name: z.string().min(1).max(120).describe('Role name, e.g. support'),
      description: z.string().max(512).optional(),
      tenant,
      project
    },
    command: ['auth', 'roles', 'create'],
    flags: a => [
      // A name may start with "-": glued with "=" it can only be the value.
      `--name=${a.name}`,
      ...optText('--description', a.description),
      ...auth_scope(a)
    ],
    write: true,
    // Role writes hand permissions to end users: never on the hosted
    // server, whose token only reads roles (api tenant_access.ts).
    local_only: true,
    annotations: { ...AUTH_WRITE, idempotentHint: false },
    example: { name: 'support', description: 'Support staff' }
  },
  {
    name: 'update_auth_role_permissions',
    title: "Change a role's permissions",
    description:
      "Grant (`add`) or revoke (`remove`) permissions of ONE API on a role. Each must be in that API's catalog (see list_auth_apis). Everyone who holds the role gets the change in their next tokens, refreshes included.",
    input: {
      role: z.string().describe('Role id (role_…) or exact name'),
      api: z
        .string()
        .describe(
          'API id (api_…) or identifier (audience URL) the permissions belong to'
        ),
      add: z.array(z.string()).optional(),
      remove: z.array(z.string()).optional(),
      tenant,
      project
    },
    command: ['auth', 'roles', 'permissions'],
    flags: a => [
      a.role,
      '--api',
      a.api,
      ...(a.add ?? []).flatMap((p: string) => ['--add', p]),
      ...(a.remove ?? []).flatMap((p: string) => ['--rm', p]),
      ...auth_scope(a)
    ],
    write: true,
    // Role writes hand permissions to end users: never on the hosted
    // server, whose token only reads roles (api tenant_access.ts).
    local_only: true,
    shape: (rows: any) =>
      (Array.isArray(rows) ? rows : []).map((p: any) => ({
        value: p.value,
        api: p.api_identifier
      })),
    annotations: AUTH_WRITE,
    example: {
      role: 'support',
      api: 'https://api.example.com',
      add: ['tickets:write'],
      remove: ['tickets:admin']
    }
  },
  {
    name: 'create_auth_api',
    title: 'Create an API',
    description:
      'Create an API (resource server) in the Auth tenant: the audience clients request tokens for. The identifier becomes the `aud` claim and cannot change later. Settings left out take the defaults (tokens last 86400 s, no roles or teams claims).',
    input: {
      identifier: z
        .string()
        .regex(/^[^-]/, 'cannot start with "-"')
        .describe(
          'Audience URL, e.g. https://api.example.com (cannot change later)'
        ),
      name: z
        .string()
        .max(120)
        .optional()
        .describe('Display name (defaults to the identifier)'),
      permissions: z
        .array(z.string())
        .optional()
        .describe('Its permission catalog, e.g. tickets:read'),
      ...api_settings_input,
      tenant,
      project
    },
    command: ['auth', 'apis', 'create'],
    flags: a => [
      a.identifier,
      ...optText('--name', a.name),
      ...(a.permissions ?? []).flatMap((p: string) => [`--permission=${p}`]),
      ...api_settings_flags(a),
      ...auth_scope(a)
    ],
    shape: api_detail,
    write: true,
    // API writes change what every token of the tenant carries: never on the
    // hosted server, whose token only reads APIs (api tenant_access.ts).
    local_only: true,
    annotations: { ...AUTH_WRITE, idempotentHint: false },
    example: {
      identifier: 'https://api.example.com',
      permissions: ['tickets:read'],
      token_lifetime: 3600,
      include_roles_in_access_token: true
    }
  },
  {
    name: 'update_auth_api',
    title: "Change an API's settings",
    description:
      "Change an API's token settings: token lifetime, RBAC, the roles and teams claims, offline access, consent, description. Only the settings passed change. Applies to tokens issued from now on; tokens already issued keep theirs until they expire. The identifier cannot change. The permission catalog is not edited here.",
    input: {
      api: z.string().describe('API id (api_…) or identifier (audience URL)'),
      ...api_settings_input,
      tenant,
      project
    },
    command: ['auth', 'apis', 'update'],
    flags: a => [a.api, ...api_settings_flags(a), ...auth_scope(a)],
    shape: api_detail,
    write: true,
    // See create_auth_api.
    local_only: true,
    annotations: AUTH_WRITE,
    example: {
      api: 'https://api.example.com',
      token_lifetime: 3600,
      include_teams_in_access_token: true
    }
  },
  {
    name: 'update_auth_user_roles',
    title: "Change a user's roles",
    description:
      "Assign (`add`) or remove (`remove`) roles of a user of the Auth tenant. Their permissions reach the user's next tokens, refreshes included; tokens already issued keep theirs until they expire. Confirm with get_auth_user that it is the right person first.",
    input: {
      user: user_ref,
      add: z.array(z.string()).optional().describe('Role ids or exact names'),
      remove: z
        .array(z.string())
        .optional()
        .describe('Role ids or exact names'),
      tenant,
      project
    },
    command: ['auth', 'users', 'roles'],
    flags: a => [
      a.user,
      ...(a.add ?? []).flatMap((r: string) => ['--add', r]),
      ...(a.remove ?? []).flatMap((r: string) => ['--rm', r]),
      ...auth_scope(a)
    ],
    write: true,
    // Role writes hand permissions to end users: never on the hosted
    // server, whose token only reads roles (api tenant_access.ts).
    local_only: true,
    shape: (rows: any) =>
      (Array.isArray(rows) ? rows : []).map((r: any) => ({
        id: r.id,
        name: r.name
      })),
    annotations: AUTH_WRITE,
    example: { user: 'ana@example.com', add: ['support'], remove: ['viewer'] }
  },
  {
    name: 'suspend_auth_user',
    title: 'Suspend a user',
    description:
      'Suspend one user of the Auth tenant: they can no longer log in, and their sessions and refresh tokens stop working (access tokens already issued live until they expire). Reversible with reinstate_auth_user. Confirm with get_auth_user that it is the right person first, and say why in `reason` — it is recorded on the user.',
    input: {
      user: user_ref,
      reason: z.string().max(512).describe('Why — recorded on the user'),
      tenant,
      project
    },
    command: ['auth', 'users', 'suspend'],
    flags: a => [a.user, '--reason', a.reason, '--yes', ...auth_scope(a)],
    write: true,
    annotations: AUTH_WRITE,
    example: { user: 'ana@example.com', reason: 'chargeback' }
  },
  {
    name: 'reinstate_auth_user',
    title: 'Reinstate a user',
    description: 'Lift the suspension of a user: they can log in again.',
    input: { user: user_ref, tenant, project },
    command: ['auth', 'users', 'reinstate'],
    flags: a => [a.user, '--yes', ...auth_scope(a)],
    write: true,
    annotations: AUTH_WRITE,
    example: { user: 'ana@example.com' }
  },
  {
    name: 'revoke_auth_sessions',
    title: 'Sign a user out everywhere',
    description:
      "End every active session of a user (the 'sign out of all devices' button): they have to log in again on each device. Access tokens already issued live until they expire.",
    input: { user: user_ref, tenant, project },
    command: ['auth', 'sessions', 'revoke'],
    flags: a => ['--user', a.user, '--yes', ...auth_scope(a)],
    write: true,
    annotations: AUTH_WRITE,
    example: { user: 'ana@example.com' }
  },
  {
    name: 'update_auth_client_fields',
    title: "Change an app's profile fields",
    description:
      "Declare which custom profile fields the users of one Auth application may write on themselves (auth-js `updateProfile`, stored in user_metadata[\"faable.com/fields\"]). `add` takes `key`, `key:string:120` or `key:enum:a,b,c`; re-adding a key replaces it. `inherit: true` drops the app's own list and uses the tenant's again. An app's own list replaces the tenant's for that app. Only the fields: the app's URLs and settings are not changed here.",
    input: {
      client: z
        .string()
        .describe(
          'The application: client resource id (client_…) or OAuth client_id'
        ),
      add: z
        .array(z.string())
        .max(20)
        .optional()
        .describe(
          'Fields to declare: key, key:string[:max_length] or key:enum:a,b,c'
        ),
      remove: z
        .array(z.string())
        .max(20)
        .optional()
        .describe('Field keys to stop accepting'),
      inherit: z
        .boolean()
        .optional()
        .describe("Drop the app's own list and use the tenant's"),
      tenant,
      project
    },
    command: ['auth', 'clients', 'update'],
    flags: a => [
      a.client,
      ...(a.add ?? []).flatMap((f: string) => ['--add-field', f]),
      ...(a.remove ?? []).flatMap((k: string) => ['--remove-field', k]),
      ...(a.inherit ? ['--inherit-fields'] : []),
      ...auth_scope(a)
    ],
    shape: (c: any) => ({
      id: c.id,
      client_id: c.client_id,
      name: c.name,
      profile_fields: c.profile_fields ?? null
    }),
    write: true,
    annotations: AUTH_WRITE,
    example: {
      client: 'client_1',
      add: ['profile:enum:student,teacher'],
      remove: ['school']
    }
  },
  {
    name: 'update_auth_client_login',
    title: 'Change how users sign in to an app',
    description:
      "Choose which login methods one Auth application offers: which connections (by id or name, as list_auth_connections shows them) and whether the passkey button appears. `only` keeps exactly those connections and removes the rest; `disable`/`enable` change one at a time. A removed connection is refused at /authorize too, not just hidden. `passkey` needs the Pro plan. `inherit: true` drops the app's own settings and follows the tenant's again. Settings not mentioned keep their current value.",
    input: {
      client: z
        .string()
        .describe(
          'The application: client resource id (client_…) or OAuth client_id'
        ),
      only: z
        .array(z.string())
        .max(50)
        .optional()
        .describe('Offer exactly these connections (id or name)'),
      disable: z
        .array(z.string())
        .max(50)
        .optional()
        .describe('Connections (id or name) to stop offering'),
      enable: z
        .array(z.string())
        .max(50)
        .optional()
        .describe('Removed connections (id or name) to offer again'),
      passkey: z
        .enum(['on', 'off', 'inherit'])
        .optional()
        .describe('Passkey sign-in button; inherit follows the tenant'),
      inherit: z
        .boolean()
        .optional()
        .describe("Drop the app's own login methods and use the tenant's"),
      tenant,
      project
    },
    command: ['auth', 'clients', 'update'],
    flags: a => [
      a.client,
      ...(a.only ?? []).flatMap((c: string) => ['--only-connections', c]),
      ...(a.disable ?? []).flatMap((c: string) => ['--disable-connection', c]),
      ...(a.enable ?? []).flatMap((c: string) => ['--enable-connection', c]),
      ...opt('--passkey-login', a.passkey),
      ...(a.inherit ? ['--inherit-login-methods'] : []),
      ...auth_scope(a)
    ],
    shape: (c: any) => ({
      id: c.id,
      client_id: c.client_id,
      name: c.name,
      login_methods: c.login_methods ?? null
    }),
    write: true,
    annotations: AUTH_WRITE,
    example: {
      client: 'client_1',
      only: ['OTP'],
      passkey: 'on'
    }
  },
  {
    name: 'send_password_setup',
    title: 'Send a password setup email',
    description:
      'Send a user the email (or code) to set or reset their password — to invite a user created by hand, or to unblock one who forgot it.',
    input: {
      user: user_ref,
      channel: z.enum(['email', 'sms', 'whatsapp']).optional(),
      tenant,
      project
    },
    command: ['auth', 'users', 'password-setup'],
    flags: a => [
      a.user,
      ...opt('--channel', a.channel),
      '--yes',
      ...auth_scope(a)
    ],
    write: true,
    annotations: { ...AUTH_WRITE, idempotentHint: false },
    example: { user: 'ana@example.com', channel: 'email' }
  },
  {
    name: 'update_auth_user',
    title: 'Update a user profile',
    description:
      "Change a user's profile: `email`, `name`, `email_verified`. Changing `email` also moves their database login identifier (the email they type at the password login) so sign-in keeps working — pass `profile_only: true` to change only the profile email and leave the login identifier. Use this when someone cannot log in because the address they were given is not the one on their account. Confirm the person first with get_auth_user.",
    input: {
      user: user_ref,
      email: z
        .string()
        .optional()
        .describe(
          'New email — also the database login identifier unless profile_only'
        ),
      name: z.string().optional(),
      email_verified: z
        .boolean()
        .optional()
        .describe(
          'Mark the email verified (true) or clear verification (false)'
        ),
      profile_only: z
        .boolean()
        .optional()
        .describe(
          'With email, change only the profile email, not the login identifier'
        ),
      connection: z
        .string()
        .optional()
        .describe(
          'Database connection id or name, when the user has more than one credential'
        ),
      tenant,
      project
    },
    command: ['auth', 'users', 'update'],
    flags: a => [
      a.user,
      ...opt('--email', a.email),
      ...opt('--name', a.name),
      ...(a.email_verified === undefined
        ? []
        : [a.email_verified ? '--email-verified' : '--no-email-verified']),
      ...(a.profile_only ? ['--profile-only'] : []),
      ...opt('--connection', a.connection),
      '--yes',
      ...auth_scope(a)
    ],
    write: true,
    annotations: { ...AUTH_WRITE, idempotentHint: true },
    example: { user: 'ana@example.com', email: 'ana@new.com' }
  },
  {
    name: 'set_auth_user_password',
    title: "Set a user's password",
    description:
      "Set a user's database password directly, to a value you choose or one this tool generates. Use it only when the person cannot receive a password-setup link at all (e.g. the email on the account does not exist) — with a link they pick their own password and it never passes through anyone else. Pass `generate: true` to get a strong password back once, or put the exact password in `password`. The password is sent to the CLI over stdin, never in the command line; it is returned only when generated.",
    input: {
      user: user_ref,
      password: z
        .string()
        .optional()
        .describe(
          'The exact new password. Omit and set generate:true to have one made.'
        ),
      generate: z
        .boolean()
        .optional()
        .describe('Generate a strong password and return it once'),
      connection: z
        .string()
        .optional()
        .describe(
          'Database connection id or name, when the user has more than one credential'
        ),
      tenant,
      project
    },
    command: ['auth', 'users', 'set-password'],
    flags: a => [
      a.user,
      ...(a.generate ? ['--generate'] : []),
      ...opt('--connection', a.connection),
      '--yes',
      ...auth_scope(a)
    ],
    // The password goes on stdin, never in argv. Nothing is piped for the
    // generate path (the CLI makes its own and never reads stdin then).
    stdin: a => (a.generate ? undefined : (a.password as string | undefined)),
    write: true,
    annotations: { ...AUTH_WRITE, idempotentHint: false },
    example: { user: 'ana@example.com', generate: true }
  },
  {
    name: 'get_auth_recovery_link',
    title: 'Get a password-reset link',
    description:
      'Mint a fresh password-reset link for a user and return it, so you can hand it over by another channel when the reset email will not reach them (e.g. the address on the account is not a real inbox). This ALSO sends the standard reset email. The link lets whoever holds it set the password, so treat it like a password; it works once, until used or expired. Returns `link` (email channel only), `ticket_id` and `channel`.',
    input: { user: user_ref, tenant, project },
    command: ['auth', 'users', 'password-setup'],
    flags: a => [a.user, '--print', '--yes', ...auth_scope(a)],
    shape: (r: any) => ({
      link: r.link,
      ticket_id: r.ticket_id,
      channel: r.channel,
      user_id: r.user_id
    }),
    write: true,
    annotations: { ...AUTH_WRITE, idempotentHint: false },
    example: { user: 'ana@example.com' }
  }
]
