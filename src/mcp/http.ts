import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { mkdtemp, rm } from 'node:fs/promises'
import http, { IncomingMessage, ServerResponse } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import { version } from '../config'
import {
  ALL_SCOPES,
  AUTH_ISSUER,
  AccessClaims,
  delegated_token_for,
  looks_like_jwt,
  oauth_enabled,
  permission_of,
  permissions_of,
  prm_url,
  protected_resource_metadata,
  resource_of,
  verify_access_token,
  www_authenticate
} from './oauth'
import { CliResult, RunOptions, run_cli } from './run_cli'
import { create_server, tools_for } from './server'
import { TOOLS } from './tools'

// `faable mcp --http` — the hosted Faable MCP server (Fase 2 of
// arch/deploy/mcp-server-faable.md), what runs at mcp.faable.com.
//
// Streamable HTTP, stateless: every POST /mcp builds a server and a transport
// for that one request, so any instance can answer anything. The caller
// authenticates with a Faable API key (dashboard → project settings → API
// keys). A key belongs to the project it was created in, and the api holds it
// there (api 2.199.2, backlog §302): it never acts as its owner nor reaches
// another project. Each tool call runs the CLI as a child
// with THAT key in its environment and an empty HOME of its own — two
// callers' credentials never meet in one process, and the key is never
// logged.
//
//   POST /mcp              the key's project
//   POST /mcp/<project>    pinned to one project (id, name or slug)
//   ?mode=write            also the reversible writes
//   ?readonly=1            reads only — not even deploy_app

export const PUBLIC_URL = 'https://mcp.faable.com'
const DOCS_URL = 'https://faable.com/docs/cli#mcp-server'
const KEYS_URL = 'https://dashboard.faable.com/settings/projects'
const MAX_BODY_BYTES = 1024 * 1024

export interface HttpOptions {
  port: number
  host?: string
  // Child processes running at once; the rest wait their turn.
  max_concurrent?: number
  // The CLI entry each call runs; by default the one serving (argv[1]).
  entry?: string
  base_url?: string
}

// `Authorization: Bearer <key>`, or Basic with the key as the user (what the
// api itself accepts). Anything else is no credential.
export const api_key_of = (req: IncomingMessage): string | null => {
  const header = req.headers.authorization ?? ''
  const bearer = /^Bearer\s+(\S+)$/i.exec(header)
  let key = bearer?.[1]
  const basic = /^Basic\s+(\S+)$/i.exec(header)
  if (!key && basic) {
    key = Buffer.from(basic[1], 'base64').toString('utf8').split(':')[0]
  }
  if (!key) return null
  // An OAuth access token (a JWT) is longer than any API key.
  if (looks_like_jwt(key)) return key.length <= 8192 ? key : null
  return /^[\w.~+/=-]{8,256}$/.test(key) ? key : null
}

// The tools a JSON-RPC body calls (one message or a batch).
export const calls_in = (body: unknown): string[] =>
  (Array.isArray(body) ? body : [body])
    .filter(
      (m: any) =>
        m?.method === 'tools/call' && typeof m?.params?.name === 'string'
    )
    .map((m: any) => m.params.name)

// /mcp → {}, /mcp/<project> → { project }; anything else → null.
export const route_of = (pathname: string): { project?: string } | null => {
  const m = /^\/mcp(?:\/([^/]+))?\/?$/.exec(pathname)
  if (!m) return null
  return m[1] ? { project: decodeURIComponent(m[1]) } : {}
}

// The environment of one call: the server's own, minus every credential and
// context it might carry, plus the caller's key and an empty HOME.
const SCRUBBED =
  /^(FAABLE_(TOKEN|API_KEY|PROJECT|AUTH_ACCOUNT|AUTH_URL|ID_TOKEN)|GITHUB_ACTIONS|ACTIONS_ID_TOKEN_.*)$/
// The credential a child runs with: the caller's API key, or the delegated
// token this server traded the caller's OAuth token for (oauth.ts).
export type ChildCredential = { api_key: string } | { token: string }

export const child_env = (cred: ChildCredential | string, home: string) => {
  const env: Record<string, string | undefined> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (!SCRUBBED.test(k)) env[k] = v
  }
  const c = typeof cred === 'string' ? { api_key: cred } : cred
  return {
    ...env,
    HOME: home,
    ...('api_key' in c
      ? { FAABLE_API_KEY: c.api_key }
      : { FAABLE_TOKEN: c.token })
  }
}

// At most `max` children at once.
const limiter = (max: number) => {
  let active = 0
  const waiting: (() => void)[] = []
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active >= max) await new Promise<void>(r => waiting.push(r))
    active++
    try {
      return await fn()
    } finally {
      active--
      waiting.shift()?.()
    }
  }
}

const runner_for =
  (
    credential: () => Promise<ChildCredential>,
    limit: ReturnType<typeof limiter>,
    entry?: string
  ): ((argv: string[], opts: RunOptions) => Promise<CliResult>) =>
  (argv, opts) =>
    limit(async () => {
      // Resolved per call, not per request: an OAuth connection trades its
      // token only when a tool actually runs, never for a tools/list.
      const cred = await credential()
      const home = await mkdtemp(path.join(os.tmpdir(), 'faable-mcp-'))
      try {
        return await run_cli(argv, {
          ...opts,
          entry,
          env: child_env(cred, home)
        })
      } finally {
        await rm(home, { recursive: true, force: true })
      }
    })

const send = (
  res: ServerResponse,
  status: number,
  body: unknown,
  type = 'application/json'
) => {
  res.writeHead(status, {
    'content-type':
      type === 'application/json' ? 'application/json; charset=utf-8' : type,
    'cache-control': 'no-store'
  })
  res.end(type === 'application/json' ? JSON.stringify(body) : String(body))
}

const read_body = (req: IncomingMessage): Promise<unknown> =>
  new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body too large'))
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'))
      } catch {
        reject(new Error('invalid JSON'))
      }
    })
    req.on('error', reject)
  })

const rpc_error = (code: number, message: string) => ({
  jsonrpc: '2.0',
  error: { code, message },
  id: null
})

// The catalog as data: the landing (faable.com/mcp) and MCP directories read
// it, so the published list is always the served one.
export const catalog = (base = PUBLIC_URL) => ({
  name: 'faable',
  version,
  endpoint: `${base}/mcp`,
  transport: 'streamable-http',
  // OAuth first when the server has it on (oauth.ts); an API key always works.
  auth: oauth_enabled()
    ? {
        type: 'oauth',
        authorization_server: AUTH_ISSUER,
        protected_resource_metadata: prm_url(base),
        scopes: ALL_SCOPES,
        alternative: {
          type: 'api-key',
          header: 'Authorization: Bearer <key>',
          keys: KEYS_URL
        }
      }
    : {
        type: 'api-key',
        header: 'Authorization: Bearer <key>',
        keys: KEYS_URL
      },
  docs: DOCS_URL,
  tools: TOOLS.map(t => ({
    name: t.name,
    title: t.title,
    description: t.description,
    access: t.annotations.readOnlyHint ? 'read' : t.write ? 'write' : 'deploy',
    requires: t.write ? 'mode=write' : undefined,
    input_schema: z.toJSONSchema(z.object(t.input))
  }))
})

export const llms_txt = (base = PUBLIC_URL) =>
  [
    '# Faable MCP server',
    '',
    '> Connects Claude, Cursor and any MCP client to Faable Deploy: read apps, deployments, build and runtime logs, traffic and domains, and deploy — without leaving the editor.',
    '',
    oauth_enabled()
      ? `Endpoint: ${base}/mcp (Streamable HTTP). Sign in with OAuth: an MCP client discovers it from the 401 (\`resource_metadata\`), opens a Faable sign-in and consent screen where the user picks one project and what the agent may do (\`deploy:read\`, \`deploy:deploy\`; \`deploy:write\` is asked for the first time a write tool is called). Or send a Faable API key: \`Authorization: Bearer <key>\` (project settings → API keys). Either way it acts on one project only.`
      : `Endpoint: ${base}/mcp (Streamable HTTP). Authenticate with a Faable API key: \`Authorization: Bearer <key>\` (create one in the dashboard, project settings → API keys). The key belongs to one project and only acts there.`,
    '',
    `- \`${base}/mcp/<project>\` pins every call to one project.`,
    '- `?mode=write` adds the reversible writes (create apps, set secrets, add domains, retry or cancel builds, change deploy settings). Nothing destructive is exposed.',
    '- `?readonly=1` exposes reads only.',
    '- Local alternative, no key: `npx -y @faable/faable mcp` (uses `faable login`).',
    '',
    '## Tools',
    '',
    ...TOOLS.map(
      t => `- \`${t.name}\`${t.write ? ' (mode=write)' : ''}: ${t.description}`
    ),
    '',
    `Docs: ${DOCS_URL}`,
    ''
  ].join('\n')

export const create_http_server = (opts: HttpOptions) => {
  const limit = limiter(opts.max_concurrent ?? 8)
  const base = opts.base_url ?? PUBLIC_URL

  return http.createServer(async (req, res) => {
    const started = Date.now()
    const url = new URL(req.url ?? '/', 'http://localhost')
    let status = 200
    const done = () =>
      // One line per request, never the key nor the body.
      process.stderr.write(
        JSON.stringify({
          msg: 'mcp_http',
          method: req.method,
          path: url.pathname.replace(/^\/mcp\/.+/, '/mcp/:project'),
          status: res.statusCode || status,
          ms: Date.now() - started
        }) + '\n'
      )
    res.on('finish', done)

    try {
      if (
        req.method === 'GET' &&
        (url.pathname === '/healthz' || url.pathname === '/livez')
      ) {
        return send(res, 200, { ok: true, version })
      }
      if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(302, { location: DOCS_URL })
        return res.end()
      }
      if (req.method === 'GET' && url.pathname === '/tools.json') {
        return send(res, 200, catalog(base))
      }
      if (req.method === 'GET' && url.pathname === '/llms.txt') {
        return send(res, 200, llms_txt(base), 'text/plain; charset=utf-8')
      }
      // RFC 9728: at the root and with the resource path inserted (what MCP
      // clients derive from https://mcp.faable.com/mcp). Only with OAuth on.
      if (
        req.method === 'GET' &&
        /^\/\.well-known\/oauth-protected-resource(\/mcp(\/[^/]+)?)?\/?$/.test(
          url.pathname
        )
      ) {
        if (!oauth_enabled()) return send(res, 404, { error: 'not found' })
        return send(res, 200, protected_resource_metadata(base))
      }

      const route = route_of(url.pathname)
      if (!route) return send(res, 404, { error: 'not found', docs: DOCS_URL })
      if (req.method !== 'POST') {
        // Stateless: no server-initiated stream, no session to delete.
        res.setHeader('allow', 'POST')
        return send(
          res,
          405,
          rpc_error(
            -32000,
            'Method not allowed: this server is stateless, use POST.'
          )
        )
      }

      const key = api_key_of(req)
      const unauthorized = (message: string, error?: string) => {
        res.setHeader(
          'www-authenticate',
          oauth_enabled()
            ? www_authenticate(base, { error })
            : 'Bearer realm="faable"'
        )
        status = 401
        return send(res, 401, rpc_error(-32001, message))
      }
      if (!key) {
        return unauthorized(
          oauth_enabled()
            ? `Connect with your Faable account (your MCP client opens the sign-in), or send a Faable API key: "Authorization: Bearer <key>" (${KEYS_URL}).`
            : `Send a Faable API key: "Authorization: Bearer <key>". Create one in the dashboard (project settings → API keys): ${KEYS_URL}`
        )
      }

      // A JWT is an OAuth access token (Fase 3); anything else, an API key.
      let claims: AccessClaims | undefined
      if (looks_like_jwt(key)) {
        if (!oauth_enabled()) {
          return unauthorized(
            `This server does not accept OAuth tokens yet. Send a Faable API key: ${KEYS_URL}`
          )
        }
        try {
          claims = await verify_access_token(key, resource_of(base))
        } catch (e) {
          return unauthorized(
            `Invalid access token: ${(e as Error).message}. Reconnect.`,
            'invalid_token'
          )
        }
      }
      const granted = claims ? permissions_of(claims) : undefined

      let body: unknown
      try {
        body = await read_body(req)
      } catch (e) {
        return send(res, 400, rpc_error(-32700, (e as Error).message))
      }

      // Step-up (MCP authorization): a tool this connection was not allowed
      // answers 403 insufficient_scope with the scope it needs, and the
      // client asks the user for it on the consent screen.
      if (granted) {
        const needed = calls_in(body)
          .map(name => TOOLS.find(t => t.name === name))
          .filter((t): t is (typeof TOOLS)[number] => !!t)
          .map(permission_of)
          .filter(p => !granted.includes(p))
        if (needed.length) {
          res.setHeader(
            'www-authenticate',
            www_authenticate(base, {
              error: 'insufficient_scope',
              scope: [...new Set([...granted, ...needed])]
            })
          )
          status = 403
          return send(
            res,
            403,
            rpc_error(
              -32001,
              `This connection was not allowed to ${needed.join(', ')}. Your MCP client will ask you to allow it.`
            )
          )
        }
      }

      const writes = url.searchParams.get('mode') === 'write'
      const server = create_server({
        writes,
        readonly: ['1', 'true'].includes(
          url.searchParams.get('readonly') ?? ''
        ),
        // An OAuth connection acts on the project the user picked on the
        // consent screen, whatever the path or the agent say.
        project: claims?.project ?? route.project,
        // Its tools are the ones its permissions allow — plus, with
        // ?mode=write, the writes it may ask for by step-up.
        allow: granted
          ? t => granted.includes(permission_of(t)) || (writes && !!t.write)
          : undefined,
        run: runner_for(
          claims
            ? async () => ({ token: await delegated_token_for(key) })
            : async () => ({ api_key: key }),
          limit,
          opts.entry
        )
      })
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true
      })
      res.on('close', () => {
        transport.close().catch(() => undefined)
        server.close().catch(() => undefined)
      })
      await server.connect(transport)
      await transport.handleRequest(req, res, body)
    } catch (e) {
      if (!res.headersSent) send(res, 500, rpc_error(-32603, 'Internal error'))
      process.stderr.write(
        JSON.stringify({ msg: 'mcp_http_error', error: (e as Error).message }) +
          '\n'
      )
    }
  })
}

export const serve_http = async (opts: HttpOptions) => {
  const server = create_http_server(opts)
  await new Promise<void>(resolve =>
    server.listen(opts.port, opts.host ?? '0.0.0.0', resolve)
  )
  process.stderr.write(
    JSON.stringify({
      msg: 'mcp_http_listening',
      port: opts.port,
      version,
      tools: tools_for({}).length
    }) + '\n'
  )
  return server
}
