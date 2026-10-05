import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import test from 'ava'
import { IncomingMessage, Server } from 'node:http'
import { AddressInfo } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { APP, PROJECT, start_api } from '../test/stub_api'
import { api_key_of, child_env, create_http_server, route_of } from './http'
import { TOOLS } from './tools'

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const req = (authorization?: string) =>
  ({ headers: authorization ? { authorization } : {} }) as IncomingMessage

test('the key comes as Bearer or as the Basic user, nothing else', t => {
  t.is(api_key_of(req('Bearer fk_live_abcdef12')), 'fk_live_abcdef12')
  t.is(
    api_key_of(
      req(`Basic ${Buffer.from('fk_live_abcdef12:').toString('base64')}`)
    ),
    'fk_live_abcdef12'
  )
  t.is(api_key_of(req()), null)
  t.is(api_key_of(req('Bearer short')), null)
  t.is(api_key_of(req('Bearer has"quote and spaces')), null)
})

test('/mcp and /mcp/<project>, nothing else', t => {
  t.deepEqual(route_of('/mcp'), {})
  t.deepEqual(route_of('/mcp/'), {})
  t.deepEqual(route_of('/mcp/My%20Project'), { project: 'My Project' })
  t.is(route_of('/mcp/a/b'), null)
  t.is(route_of('/other'), null)
})

test("a call's environment carries the caller's key and nothing of the server's", t => {
  const saved = { ...process.env }
  Object.assign(process.env, {
    FAABLE_TOKEN: 'server-session',
    FAABLE_PROJECT: 'project_server',
    GITHUB_ACTIONS: 'true',
    FAABLE_API_URL: 'http://api'
  })
  try {
    const env: Record<string, string | undefined> = child_env(
      'fk_live_caller1',
      '/tmp/home-x'
    )
    t.is(env.FAABLE_API_KEY, 'fk_live_caller1')
    t.is(env.HOME, '/tmp/home-x')
    t.is(env.FAABLE_TOKEN, undefined)
    t.is(env.FAABLE_PROJECT, undefined)
    t.is(env.GITHUB_ACTIONS, undefined)
    // Configuration that is not a credential passes through.
    t.is(env.FAABLE_API_URL, 'http://api')
  } finally {
    process.env = saved
  }
})

// The hosted server for real: in this process, its children running the CLI
// from source against the stub api.
const start_mcp = async (api_url: string) => {
  process.env.FAABLE_API_URL = api_url
  const server: Server = create_http_server({
    port: 0,
    entry: path.join(src, 'index.ts'),
    base_url: 'http://mcp.test'
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const { port } = server.address() as AddressInfo
  return { url: `http://127.0.0.1:${port}`, close: () => server.close() }
}

const client_for = async (url: string, key: string) => {
  const client = new Client({ name: 'test', version: '0.0.0' })
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { authorization: `Bearer ${key}` } }
    })
  )
  return client
}

const text_of = (r: any) => (r.content as { text: string }[])[0].text

test.serial('without a key: 401 that says where to get one', async t => {
  const api = await start_api()
  const mcp = await start_mcp(api.url)
  try {
    const res = await fetch(`${mcp.url}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream'
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    })
    t.is(res.status, 401)
    t.regex(((await res.json()) as any).error.message, /API key/)
    t.deepEqual(api.requests, [])
  } finally {
    mcp.close()
    api.close()
  }
})

test.serial("each call goes to the api with the caller's own key", async t => {
  const api = await start_api()
  const mcp = await start_mcp(api.url)
  const [a, b] = await Promise.all([
    client_for(`${mcp.url}/mcp`, 'fk_live_alice001'),
    client_for(`${mcp.url}/mcp`, 'fk_live_bob00002')
  ])
  try {
    // Concurrent, interleaved: each child carries its own caller's key.
    const results = await Promise.all([
      a.callTool({ name: 'list_apps', arguments: {} }),
      b.callTool({ name: 'list_apps', arguments: {} }),
      a.callTool({ name: 'get_app', arguments: { app: APP.id } })
    ])
    for (const r of results) t.falsy(r.isError, text_of(r))
    // Per call, not per run: each result was fetched with ITS caller's key.
    const [alice_list, bob_list, alice_get] = results.map(text_of)
    t.regex(alice_list, /seen-by:fk_live_alice001/)
    t.regex(bob_list, /seen-by:fk_live_bob00002/)
    t.regex(alice_get, /seen-by:fk_live_alice001/)
    const basic = (key: string) =>
      `Basic ${Buffer.from(`${key}:`).toString('base64')}`
    // Sorted: the calls run concurrently, so arrival order varies.
    const seen = [...new Set(api.requests.map(r => r.authorization))].sort()
    t.deepEqual(
      seen,
      [basic('fk_live_alice001'), basic('fk_live_bob00002')].sort()
    )
    t.is(
      api.requests.filter(r => r.authorization === basic('fk_live_bob00002'))
        .length,
      1
    )
    t.true(api.requests.every(r => r.client?.startsWith('faable-mcp/')))
  } finally {
    await a.close()
    await b.close()
    mcp.close()
    api.close()
  }
})

test.serial('the URL picks the catalog and pins the project', async t => {
  const api = await start_api()
  const mcp = await start_mcp(api.url)
  const names = async (q: string) => {
    const c = await client_for(`${mcp.url}/mcp${q}`, 'fk_live_alice001')
    const { tools } = await c.listTools()
    await c.close()
    return tools.map(x => x.name)
  }
  try {
    const plain = await names('')
    t.true(plain.includes('deploy_app'))
    t.false(plain.includes('set_secrets'))
    t.true((await names('?mode=write')).includes('set_secrets'))
    const readonly = await names('?readonly=1')
    t.false(readonly.includes('deploy_app'))
    t.true(readonly.includes('get_build_logs'))

    const pinned = await client_for(
      `${mcp.url}/mcp/${PROJECT}`,
      'fk_live_alice001'
    )
    const r = await pinned.callTool({
      name: 'list_apps',
      arguments: { project: 'project_other' }
    })
    await pinned.close()
    t.falsy(r.isError, text_of(r))
    // The pinned project wins over the one the agent asked for.
    t.is(api.requests.find(x => x.path === '/app')?.project, PROJECT)
  } finally {
    mcp.close()
    api.close()
  }
})

test.serial(
  'the catalog and llms.txt are served from the registry',
  async t => {
    const api = await start_api()
    const mcp = await start_mcp(api.url)
    try {
      const catalog = (await (
        await fetch(`${mcp.url}/tools.json`)
      ).json()) as any
      t.is(catalog.endpoint, 'http://mcp.test/mcp')
      // Everything but what works on the user's own disk.
      t.is(catalog.tools.length, TOOLS.filter(x => !x.local_only).length)
      t.false(catalog.tools.some((x: any) => x.name === 'deploy_directory'))
      t.is(catalog.tools.find((x: any) => x.name === 'list_auth_logins').product, 'auth')
      t.is(catalog.tools.find((x: any) => x.name === 'list_apps').product, 'deploy')
      t.is(
        catalog.tools.find((x: any) => x.name === 'set_secrets').requires,
        'mode=write'
      )
      t.is(
        catalog.tools.find((x: any) => x.name === 'get_app').input_schema.type,
        'object'
      )
      const llms = await (await fetch(`${mcp.url}/llms.txt`)).text()
      t.regex(llms, /http:\/\/mcp\.test\/mcp/)
      t.is((await fetch(`${mcp.url}/healthz`)).status, 200)
      t.is((await fetch(`${mcp.url}/mcp`, { method: 'GET' })).status, 405)
    } finally {
      mcp.close()
      api.close()
    }
  }
)
