import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import test from 'ava'
import { generateKeyPairSync, sign as rsaSign } from 'node:crypto'
import { Server } from 'node:http'
import { AddressInfo } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PROJECT, start_api } from '../test/stub_api'
import { create_http_server } from './http'
import { AUTH_ISSUER, set_oauth_fetch } from './oauth'

// OAuth on the hosted server (arch/auth/mcp-oauth.md 3.5): the client's token
// is checked and never reaches the api; the tools are the ones its
// permissions allow; a tool it was not allowed asks for a step-up.

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASE = 'http://mcp.test'
const RESOURCE = `${BASE}/mcp`

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048
})
const jwk = { ...(publicKey.export({ format: 'jwk' }) as object), kid: 'k1' }
const b64u = (v: object) => Buffer.from(JSON.stringify(v)).toString('base64url')
const token = (claims: Record<string, unknown>) => {
  const now = Math.floor(Date.now() / 1000)
  const head = b64u({ alg: 'RS256', typ: 'JWT', kid: 'k1' })
  const body = b64u({
    iss: AUTH_ISSUER,
    aud: RESOURCE,
    sub: 'user_6555fd293acc2f0fac0e3452',
    client_id: 'https://claude.ai/oauth/claude-code-client-metadata',
    iat: now,
    exp: now + 600,
    project: PROJECT,
    ...claims
  })
  const sig = rsaSign('RSA-SHA256', Buffer.from(`${head}.${body}`), privateKey)
  return `${head}.${body}.${sig.toString('base64url')}`
}

const DELEGATED = 'delegated.token.for-the-api'
const exchanges: URLSearchParams[] = []

test.before(() => {
  process.env.FAABLE_MCP_CLIENT_ID = 'mcp-server'
  process.env.FAABLE_MCP_CLIENT_SECRET = 'shh'
  // Faable Auth, as far as this server talks to it.
  set_oauth_fetch((async (input: any, init?: any) => {
    const url = String(input)
    if (url.endsWith('/.well-known/jwks.json')) {
      return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 })
    }
    if (url.endsWith('/oauth/token')) {
      const form = new URLSearchParams(String(init?.body))
      exchanges.push(form)
      return new Response(
        JSON.stringify({ access_token: DELEGATED, token_type: 'Bearer' }),
        { status: 200 }
      )
    }
    return new Response('not found', { status: 404 })
  }) as typeof fetch)
})

test.after.always(() => {
  delete process.env.FAABLE_MCP_CLIENT_ID
  delete process.env.FAABLE_MCP_CLIENT_SECRET
  set_oauth_fetch()
})

const start_mcp = async (api_url: string) => {
  process.env.FAABLE_API_URL = api_url
  const server: Server = create_http_server({
    port: 0,
    entry: path.join(src, 'index.ts'),
    base_url: BASE
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const { port } = server.address() as AddressInfo
  return { url: `http://127.0.0.1:${port}`, close: () => server.close() }
}

const rpc = (url: string, body: unknown, authorization?: string) =>
  fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(authorization ? { authorization } : {})
    },
    body: JSON.stringify(body)
  })

const client_for = async (url: string, bearer: string) => {
  const client = new Client({ name: 'test', version: '0.0.0' })
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { authorization: `Bearer ${bearer}` } }
    })
  )
  return client
}

test.serial(
  'protected resource metadata names Faable Auth (RFC 9728)',
  async t => {
    const api = await start_api()
    const mcp = await start_mcp(api.url)
    try {
      for (const p of [
        '/.well-known/oauth-protected-resource',
        '/.well-known/oauth-protected-resource/mcp'
      ]) {
        const res = await fetch(`${mcp.url}${p}`)
        t.is(res.status, 200, p)
        const body: any = await res.json()
        t.is(body.resource, RESOURCE)
        t.deepEqual(body.authorization_servers, [AUTH_ISSUER])
      }
    } finally {
      mcp.close()
      api.close()
    }
  }
)

test.serial(
  'no credential: 401 that points the client at the metadata',
  async t => {
    const api = await start_api()
    const mcp = await start_mcp(api.url)
    try {
      const res = await rpc(`${mcp.url}/mcp`, {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list'
      })
      t.is(res.status, 401)
      const header = res.headers.get('www-authenticate') ?? ''
      t.regex(
        header,
        /resource_metadata="http:\/\/mcp\.test\/\.well-known\/oauth-protected-resource\/mcp"/
      )
      t.regex(header, /scope="deploy:read deploy:deploy"/)
    } finally {
      mcp.close()
      api.close()
    }
  }
)

test.serial('a token for another resource is refused', async t => {
  const api = await start_api()
  const mcp = await start_mcp(api.url)
  try {
    const res = await rpc(
      `${mcp.url}/mcp`,
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      `Bearer ${token({ aud: 'https://api.faable.com', permissions: 'deploy:read' })}`
    )
    t.is(res.status, 401)
    t.regex(res.headers.get('www-authenticate') ?? '', /error="invalid_token"/)
    t.deepEqual(api.requests, [])
  } finally {
    mcp.close()
    api.close()
  }
})

test.serial('the tools are what the permissions allow', async t => {
  const api = await start_api()
  const mcp = await start_mcp(api.url)
  try {
    const names = async (perms: string, query = '') => {
      const c = await client_for(
        `${mcp.url}/mcp${query}`,
        token({ permissions: perms })
      )
      const { tools } = await c.listTools()
      await c.close()
      return tools.map(t => t.name)
    }
    const read = await names('deploy:read')
    t.true(read.includes('get_build_logs'))
    t.false(read.includes('deploy_app'))

    const deploy = await names('deploy:read deploy:deploy')
    t.true(deploy.includes('deploy_app'))
    t.false(deploy.includes('set_secrets'))

    // ?mode=write lists the writes so the agent can ask for them.
    t.true(
      (await names('deploy:read deploy:deploy', '?mode=write')).includes(
        'set_secrets'
      )
    )
  } finally {
    mcp.close()
    api.close()
  }
})

test.serial(
  'a tool not allowed asks for a step-up (403 insufficient_scope)',
  async t => {
    const api = await start_api()
    const mcp = await start_mcp(api.url)
    try {
      const res = await rpc(
        `${mcp.url}/mcp?mode=write`,
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'set_secrets',
            arguments: { app: 'x', variables: { A: '1' } }
          }
        },
        `Bearer ${token({ permissions: 'deploy:read deploy:deploy' })}`
      )
      t.is(res.status, 403)
      const header = res.headers.get('www-authenticate') ?? ''
      t.regex(header, /error="insufficient_scope"/)
      t.regex(header, /scope="deploy:read deploy:deploy deploy:write"/)
      t.deepEqual(api.requests, [])
    } finally {
      mcp.close()
      api.close()
    }
  }
)

test.serial(
  'a tool call reaches the api with the delegated token, never the client one',
  async t => {
    const api = await start_api()
    const mcp = await start_mcp(api.url)
    const client_token = token({ permissions: 'deploy:read deploy:deploy' })
    try {
      const c = await client_for(`${mcp.url}/mcp`, client_token)
      const r: any = await c.callTool({ name: 'list_apps', arguments: {} })
      t.falsy(r.isError, JSON.stringify(r))
      await c.close()

      const auths = [...new Set(api.requests.map(r => r.authorization))]
      t.deepEqual(auths, [`Bearer ${DELEGATED}`])
      t.false(api.requests.some(r => r.authorization?.includes(client_token)))
      // Pinned to the project the user picked, whatever the agent says.
      t.true(api.requests.every(r => !r.project || r.project === PROJECT))

      const last = exchanges.at(-1)!
      t.is(last.get('subject_token'), client_token)
      t.is(last.get('client_id'), 'mcp-server')
      t.is(
        last.get('subject_token_type'),
        'urn:ietf:params:oauth:token-type:access_token'
      )
    } finally {
      mcp.close()
      api.close()
    }
  }
)

test.serial('API keys keep working next to OAuth', async t => {
  const api = await start_api()
  const mcp = await start_mcp(api.url)
  try {
    const c = await client_for(`${mcp.url}/mcp`, 'fk_live_alice001')
    const r: any = await c.callTool({ name: 'list_apps', arguments: {} })
    t.falsy(r.isError)
    await c.close()
    t.is(
      api.requests[0].authorization,
      `Basic ${Buffer.from('fk_live_alice001:').toString('base64')}`
    )
  } finally {
    mcp.close()
    api.close()
  }
})
