import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { mkdtemp, rm } from 'node:fs/promises'
import http, { IncomingMessage, ServerResponse } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import { version } from '../config'
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
  return key && /^[\w.~+/=-]{8,256}$/.test(key) ? key : null
}

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
export const child_env = (key: string, home: string) => {
  const env: Record<string, string | undefined> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (!SCRUBBED.test(k)) env[k] = v
  }
  return { ...env, HOME: home, FAABLE_API_KEY: key }
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
    key: string,
    limit: ReturnType<typeof limiter>,
    entry?: string
  ): ((argv: string[], opts: RunOptions) => Promise<CliResult>) =>
  (argv, opts) =>
    limit(async () => {
      const home = await mkdtemp(path.join(os.tmpdir(), 'faable-mcp-'))
      try {
        return await run_cli(argv, {
          ...opts,
          entry,
          env: child_env(key, home)
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
  auth: {
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
    `Endpoint: ${base}/mcp (Streamable HTTP). Authenticate with a Faable API key: \`Authorization: Bearer <key>\` (create one in the dashboard, project settings → API keys). The key belongs to one project and only acts there.`,
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
      if (!key) {
        res.setHeader('www-authenticate', 'Bearer realm="faable"')
        status = 401
        return send(
          res,
          401,
          rpc_error(
            -32001,
            `Send a Faable API key: "Authorization: Bearer <key>". Create one in the dashboard (project settings → API keys): ${KEYS_URL}`
          )
        )
      }

      let body: unknown
      try {
        body = await read_body(req)
      } catch (e) {
        return send(res, 400, rpc_error(-32700, (e as Error).message))
      }

      const server = create_server({
        writes: url.searchParams.get('mode') === 'write',
        readonly: ['1', 'true'].includes(
          url.searchParams.get('readonly') ?? ''
        ),
        project: route.project,
        run: runner_for(key, limit, opts.entry)
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
