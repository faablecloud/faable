import { createHash, createPublicKey, verify as rsaVerify } from 'node:crypto'
import type { ToolDef } from './tools'

// OAuth on mcp.faable.com (Fase 3 of arch/deploy/mcp-server-faable.md; plan
// in arch/auth/mcp-oauth.md 3.5). The MCP server is a resource server:
//
//   1. the MCP client gets a token from Faable Auth for THIS resource
//      (aud = https://mcp.faable.com/mcp) after the user allowed it on the
//      consent screen — permissions and one project;
//   2. this server checks it (issuer, audience, expiry, signature) and shows
//      only the tools its permissions allow;
//   3. for a tool call it trades it at Faable Auth (RFC 8693) for a short
//      token of its own, `act` = this server, and the CLI child calls the
//      api with that. The client's token is never passed on (MCP spec:
//      MUST NOT), and the api refuses it if anyone tries.
//
// Off unless the server has its own client credentials
// (FAABLE_MCP_CLIENT_ID / FAABLE_MCP_CLIENT_SECRET): advertising OAuth before
// Faable Auth accepts MCP clients would send them into a flow that fails.
// API keys keep working either way.

export const AUTH_ISSUER =
  process.env.FAABLE_MCP_AUTH_ISSUER ?? 'https://faable.auth.faable.link'

export const oauth_enabled = () =>
  !!process.env.FAABLE_MCP_CLIENT_ID && !!process.env.FAABLE_MCP_CLIENT_SECRET

export type Permission =
  | 'deploy:read'
  | 'deploy:deploy'
  | 'deploy:write'
  // Faable Auth tools. NOT in ALL_SCOPES yet: Faable Auth has to register
  // them on the MCP resource (consent screen) first — until then an OAuth
  // connection is never granted them, so it does not see the Auth tools.
  // API keys and the local server are unaffected.
  | 'auth:read'
  | 'auth:write'

// What the consent screen asks for on a first connection (Marc, 05-10:
// reads plus deploy, like the hosted server by default). deploy:write comes
// by step-up, the first time an agent calls a tool that needs it.
export const DEFAULT_SCOPES: Permission[] = ['deploy:read', 'deploy:deploy']
export const ALL_SCOPES: Permission[] = [
  'deploy:read',
  'deploy:deploy',
  'deploy:write'
]

const DEPLOY_TOOLS = new Set(['deploy_app', 'redeploy', 'cancel_deployment'])

/** The permission a tool needs — the same split the api enforces. */
export const permission_of = (
  tool: Pick<ToolDef, 'name' | 'write' | 'command'>
): Permission =>
  tool.command?.[0] === 'auth'
    ? tool.write
      ? 'auth:write'
      : 'auth:read'
    : DEPLOY_TOOLS.has(tool.name)
    ? 'deploy:deploy'
    : tool.write
      ? 'deploy:write'
      : 'deploy:read'

export const resource_of = (base: string) => `${base}/mcp`

/** RFC 9728 Protected Resource Metadata. */
export const protected_resource_metadata = (base: string) => ({
  resource: resource_of(base),
  authorization_servers: [AUTH_ISSUER],
  scopes_supported: ALL_SCOPES,
  bearer_methods_supported: ['header'],
  resource_name: 'Faable',
  resource_documentation: 'https://faable.com/mcp'
})

export const prm_url = (base: string) =>
  `${base}/.well-known/oauth-protected-resource/mcp`

/** The `WWW-Authenticate` of a 401/403 (RFC 6750 §3, MCP authorization). */
export const www_authenticate = (
  base: string,
  extra: { error?: string; scope?: string[] } = {}
) =>
  [
    'Bearer realm="faable"',
    `resource_metadata="${prm_url(base)}"`,
    `scope="${(extra.scope ?? DEFAULT_SCOPES).join(' ')}"`,
    ...(extra.error ? [`error="${extra.error}"`] : [])
  ].join(', ')

export const looks_like_jwt = (token: string) =>
  /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)

// ── Verifying the client's token ──────────────────────────────────────────

type Jwk = { kid?: string; kty: string; n: string; e: string; alg?: string }

let jwks_cache: { keys: Jwk[]; at: number } | null = null
const JWKS_TTL_MS = 10 * 60 * 1000

type Fetch = typeof fetch
let http: Fetch = (input, init) => fetch(input, init)
/** Seam for tests. */
export const set_oauth_fetch = (f?: Fetch) => {
  http = f ?? ((input, init) => fetch(input, init))
  jwks_cache = null
  exchange_cache.clear()
}

const jwk_for = async (kid: string | undefined): Promise<Jwk | undefined> => {
  const pick = (keys: Jwk[]) => keys.find(k => !kid || k.kid === kid)
  if (jwks_cache && Date.now() - jwks_cache.at < JWKS_TTL_MS) {
    const hit = pick(jwks_cache.keys)
    if (hit) return hit
  }
  // A kid we do not know yet may be a rotation: fetch once more.
  const res = await http(`${AUTH_ISSUER}/.well-known/jwks.json`)
  if (!res.ok) throw new Error(`jwks: HTTP ${res.status}`)
  const body = (await res.json()) as { keys: Jwk[] }
  jwks_cache = { keys: body.keys ?? [], at: Date.now() }
  return pick(jwks_cache.keys)
}

export type AccessClaims = {
  sub: string
  aud: string | string[]
  iss: string
  exp: number
  client_id?: string
  permissions?: string
  project?: string
  [k: string]: unknown
}

const b64json = (part: string) =>
  JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))

export class InvalidToken extends Error {}

/** The claims of a valid token for this resource, or InvalidToken. */
export const verify_access_token = async (
  token: string,
  resource: string
): Promise<AccessClaims> => {
  const [h, p, s] = token.split('.')
  let header: { alg?: string; kid?: string; typ?: string }
  let claims: AccessClaims
  try {
    header = b64json(h)
    claims = b64json(p)
  } catch {
    throw new InvalidToken('malformed token')
  }
  if (header.alg !== 'RS256') throw new InvalidToken('unexpected algorithm')
  if (claims.iss !== AUTH_ISSUER) throw new InvalidToken('unexpected issuer')
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
  // RFC 8707 / MCP: a token for another resource is not ours to accept.
  if (!aud.includes(resource))
    throw new InvalidToken('token is for another resource')
  if (!claims.exp || claims.exp * 1000 < Date.now())
    throw new InvalidToken('token expired')
  const jwk = await jwk_for(header.kid)
  if (!jwk) throw new InvalidToken('unknown signing key')
  const ok = rsaVerify(
    'RSA-SHA256',
    Buffer.from(`${h}.${p}`),
    createPublicKey({ key: jwk as any, format: 'jwk' }),
    Buffer.from(s, 'base64url')
  )
  if (!ok) throw new InvalidToken('bad signature')
  if (!claims.sub) throw new InvalidToken('token has no subject')
  return claims
}

export const permissions_of = (claims: AccessClaims): Permission[] =>
  String(claims.permissions ?? '')
    .split(' ')
    .filter((p): p is Permission => (ALL_SCOPES as string[]).includes(p))

// ── Trading it for our own (RFC 8693) ─────────────────────────────────────

const exchange_cache = new Map<string, { token: string; until: number }>()
// Shorter than the delegated token's own life, so a cached one never expires
// mid-call, and short enough that a disconnected app stops within a minute.
const EXCHANGE_CACHE_MS = 60 * 1000

export class ExchangeRefused extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

export const delegated_token_for = async (subject: string): Promise<string> => {
  const key = createHash('sha256').update(subject).digest('base64url')
  const hit = exchange_cache.get(key)
  if (hit && hit.until > Date.now()) return hit.token

  const res = await http(`${AUTH_ISSUER}/oauth/token`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-faable-client': 'faable-mcp'
    },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      client_id: process.env.FAABLE_MCP_CLIENT_ID ?? '',
      client_secret: process.env.FAABLE_MCP_CLIENT_SECRET ?? '',
      subject_token: subject,
      subject_token_type: 'urn:ietf:params:oauth:token-type:access_token'
    }).toString()
  })
  const body = (await res.json().catch(() => ({}))) as {
    access_token?: string
    error_description?: string
  }
  if (!res.ok || !body.access_token) {
    throw new ExchangeRefused(
      body.error_description ?? `token exchange: HTTP ${res.status}`,
      res.status
    )
  }
  exchange_cache.set(key, {
    token: body.access_token,
    until: Date.now() + EXCHANGE_CACHE_MS
  })
  // Bounded: one entry per live connection, swept as they expire.
  if (exchange_cache.size > 5000) {
    for (const [k, v] of exchange_cache)
      if (v.until <= Date.now()) exchange_cache.delete(k)
  }
  return body.access_token
}
