import { z } from 'zod'

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
  // The output carries text a third party wrote (build/runtime logs, commit
  // messages, failure reasons): it goes back wrapped as data (riesgo de
  // inyección del plan).
  untrusted?: boolean
  // What of the CLI's JSON the agent needs; the rest is context it pays for.
  shape?: (data: any, a: Args) => unknown
  annotations: {
    readOnlyHint: boolean
    destructiveHint?: boolean
    idempotentHint?: boolean
    openWorldHint?: boolean
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
const opt = (flag: string, value: unknown) =>
  value === undefined || value === null || value === ''
    ? []
    : [flag, String(value)]

const READ = { readOnlyHint: true, openWorldHint: true } as const

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

export const TOOLS: ToolDef[] = [
  {
    name: 'whoami',
    title: 'Who is logged in',
    description:
      'The Faable account this server acts as, the active project and its Auth tenant. Use it first when unsure whether the user is logged in or which project is active.',
    input: {},
    command: ['whoami'],
    flags: () => [],
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
      'Everything recorded about one deployment: phase, commit, detected stack, the runnable artifact and the FULL failure reason. Without `deployment`, the newest one of the app.',
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
      'The build output of a deployment — the first thing to read when a deploy failed and the user asks why. The cause is usually at the end. Without `deployment`, the newest one.',
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
    description: 'Custom domains of an app and whether their DNS is verified.',
    input: { app, project },
    command: ['deploy', 'domains', 'list'],
    flags: target,
    shape: page((d: any) => ({
      id: d.id,
      fqdn: d.fqdn,
      verified: d.verified,
      tls: d.tls,
      dns_message: d.status?.dns_message
    })),
    annotations: READ,
    example: { app: 'web' }
  },
  {
    name: 'check_domain',
    title: 'Check a domain',
    description:
      'DNS diagnostic of one custom domain: the CNAME it expects, what DNS answers today, and why it is not verified yet.',
    input: {
      app,
      project,
      fqdn: z.string().describe('The domain, e.g. www.example.com')
    },
    command: ['deploy', 'domains', 'check'],
    flags: a => [a.fqdn, ...target(a)],
    shape: (d: any) => ({
      fqdn: d.fqdn,
      verified: d.verified,
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
  {
    name: 'deploy_app',
    title: 'Deploy an app',
    description:
      "Build and deploy the latest commit of the app's deploy branch on Faable's servers — the same as a git push. Nothing is uploaded from this machine. Returns the deployment id; follow it with get_deployment and get_build_logs. Only for apps with push-to-deploy.",
    input: { app, project },
    command: ['deploy', 'trigger'],
    flags: target,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true
    },
    example: { app: 'web' }
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
      project
    },
    command: ['deploy', 'apps', 'create'],
    flags: a => [
      '--repo',
      a.repo,
      ...opt('--name', a.name),
      ...opt('--branch', a.branch),
      ...(a.deploy === false ? ['--no-deploy'] : []),
      ...scope(a)
    ],
    write: true,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true
    },
    example: { repo: 'acme/web', name: 'web', branch: 'main', deploy: false }
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
      'Add or update environment variables of an app. The app restarts to apply them when a value changed. Returns the names added, updated and unchanged — never the values.',
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
      'Attach a custom domain to an app. Returns the CNAME record the user must create at their DNS provider; Faable verifies it and issues the certificate on its own.',
    input: { app, project, fqdn: z.string().describe('e.g. www.example.com') },
    command: ['deploy', 'domains', 'add'],
    flags: a => [a.fqdn, ...target(a)],
    write: true,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true
    },
    example: { app: 'web', fqdn: 'www.example.com' }
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
  }
]
