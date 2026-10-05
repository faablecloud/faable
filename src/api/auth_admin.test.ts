// `faable auth` manages a tenant with the per-tenant token the deploy api
// issues (phase 2/3 of arch/auth/management-api-tenant-isolation.md), and only
// falls back to the `faable login` token where no such token exists.
import test from 'ava'
import { issueTenantToken, resolveAccountByHost } from './auth_admin'

const failing = (status?: number) => ({
  issueAuthAccountToken: async () => {
    throw status ? { response: { status } } : new Error('ECONNREFUSED')
  }
})

test('uses the tenant token the api issues', async t => {
  const api = {
    issueAuthAccountToken: async (id: string) => ({
      access_token: `tenant-token-for-${id}`,
      expires_in: 900
    })
  }
  t.is(
    await issueTenantToken('session', 'account_a', api),
    'tenant-token-for-account_a'
  )
})

test('falls back to the session token when no tenant token exists', async t => {
  for (const status of [404, 501, 503, undefined]) {
    t.is(
      await issueTenantToken('session', 'account_a', failing(status)),
      undefined,
      String(status)
    )
  }
})

test('a 403 (not a member) is an error, never a fallback', async t => {
  const err = await t.throwsAsync(
    issueTenantToken('session', 'account_a', failing(403))
  )
  t.regex(err!.message, /not a member/)
})

test('other api errors propagate', async t => {
  await t.throwsAsync(issueTenantToken('session', 'account_a', failing(500)), {
    any: true
  })
})

test('resolves the tenant from the Auth host through the public lookup', async t => {
  const seen: string[] = []
  const auth = {
    fetcher: {
      get: async (url: string) => {
        seen.push(url)
        return { id: 'account_from_host' }
      }
    }
  } as any
  t.is(
    await resolveAccountByHost('https://acme.auth.faable.link', auth),
    'account_from_host'
  )
  t.deepEqual(seen, ['/account/host/acme.auth.faable.link'])
})

test('an unresolvable host leaves the tenant to the server', async t => {
  const auth = {
    fetcher: {
      get: async () => {
        throw { response: { status: 404 } }
      }
    }
  } as any
  t.is(await resolveAccountByHost('https://nope.example', auth), undefined)
})

// ── which tenant: --account, --auth-url, else the active project's ─────────

import fs from 'fs-extra'
import os from 'os'
import path from 'path'
import { ContextStore } from '../lib/ContextStore'
import { TenantTokenCache, cachedTenantToken, resolveTenant } from './auth_admin'

const PROJECT = 'project_6a8ebd6160324d4631c12edc'
const acct = (n: number) => ({
  id: `account_${n}`,
  name: `Tenant ${n}`,
  domain: `t${n}.auth.faable.link`
})

const tmpdir = () => fs.mkdtemp(path.join(os.tmpdir(), 'faable-auth-'))

const deploy = (accounts: ReturnType<typeof acct>[]) => {
  const asked: string[] = []
  return {
    asked,
    api: {
      listProjects: async () => ({ results: [], next: null }),
      listProjectAuthAccounts: async (id: string) => {
        asked.push(id)
        return { results: accounts, next: null }
      }
    }
  }
}

const env = { FAABLE_PROJECT: PROJECT }

test('--account wins and never asks the project', async t => {
  const d = deploy([acct(1)])
  const tenant = await resolveTenant({ account: 'account_x' }, d.api, new ContextStore(await tmpdir()), env)
  t.is(tenant.account, 'account_x')
  t.is(tenant.source, 'account')
  t.deepEqual(d.asked, [])
})

test("the project's only tenant is the one, on its own host", async t => {
  const d = deploy([acct(1)])
  const tenant = await resolveTenant({}, d.api, new ContextStore(await tmpdir()), env)
  t.deepEqual(d.asked, [PROJECT])
  t.is(tenant.account, 'account_1')
  t.is(tenant.domain, 'https://t1.auth.faable.link')
  t.is(tenant.source, 'project')
})

test('several tenants: the stored choice, or an error that lists them', async t => {
  const d = deploy([acct(1), acct(2)])
  const store = new ContextStore(await tmpdir())
  await t.throwsAsync(resolveTenant({}, d.api, store, env), {
    message: /account_1.*account_2.*faable auth use/
  })
  await store.update(c => ({ ...c, auth_accounts: { [PROJECT]: 'account_2' } }))
  t.is((await resolveTenant({}, d.api, store, env)).account, 'account_2')
})

test('no tenant in the project is an error — never the Faable tenant', async t => {
  const d = deploy([])
  const err = await t.throwsAsync(
    resolveTenant({}, d.api, new ContextStore(await tmpdir()), env)
  )
  t.regex(err!.message, /has no Faable Auth tenant/)
})

// A JWT the cache can read (`sub`, `exp`); the signature is never checked here.
const jwt = (claims: object) =>
  `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.y`

test('the tenant token is reused while live, for the same session only', async t => {
  const cache = new TenantTokenCache(path.join(await tmpdir(), 'tokens.json'))
  let issued = 0
  const api = {
    issueAuthAccountToken: async () => {
      issued++
      return { access_token: jwt({ exp: Date.now() / 1000 + 900, n: issued }), expires_in: 900 }
    }
  }
  const alice = jwt({ sub: 'user_alice' })
  const first = await cachedTenantToken(alice, 'account_1', api, cache)
  t.is(await cachedTenantToken(alice, 'account_1', api, cache), first)
  t.is(issued, 1)
  // Another login on the same machine doesn't inherit it.
  await cachedTenantToken(jwt({ sub: 'user_bob' }), 'account_1', api, cache)
  t.is(issued, 2)
})

test('an expired cached token is issued again', async t => {
  const cache = new TenantTokenCache(path.join(await tmpdir(), 'tokens.json'))
  const session = jwt({ sub: 'user_alice' })
  await cache.set('account_1', 'user_alice', jwt({ exp: Date.now() / 1000 - 10 }))
  const fresh = jwt({ exp: Date.now() / 1000 + 900 })
  const api = { issueAuthAccountToken: async () => ({ access_token: fresh, expires_in: 900 }) }
  t.is(await cachedTenantToken(session, 'account_1', api, cache), fresh)
})

// The hosted MCP runs `faable auth` with the caller's deploy API key: the
// tenant token comes from the api (narrowed there), and there is no session
// bearer to fall back on.
import { requireAuthAdminWithApiKey } from './auth_admin'

const keyApi = (issue: () => Promise<any>) => {
  const issued: string[] = []
  return {
    issued,
    api: {
      listProjects: async () => ({ results: [], next: null }),
      listProjectAuthAccounts: async () => ({ results: [], next: null }),
      issueAuthAccountToken: async (id: string) => {
        issued.push(id)
        return issue()
      }
    } as any
  }
}

test('API key: the tenant token is asked for that tenant and used', async t => {
  const k = keyApi(async () => ({ access_token: 'narrow', expires_in: 900 }))
  const client = await requireAuthAdminWithApiKey(
    { account: 'account_x' },
    'key',
    k.api
  )
  t.deepEqual(k.issued, ['account_x'])
  t.truthy(client)
})

test('API key: no tenant token is a refusal, never the key as a bearer', async t => {
  for (const status of [404, 503]) {
    const k = keyApi(async () => {
      throw { response: { status } }
    })
    const err: any = await t.throwsAsync(
      requireAuthAdminWithApiKey({ account: 'account_x' }, 'key', k.api)
    )
    t.is(err.code, 'forbidden', String(status))
  }
})

test("API key: another project's tenant (403) is an error", async t => {
  const k = keyApi(async () => {
    throw { response: { status: 403 } }
  })
  await t.throwsAsync(
    requireAuthAdminWithApiKey({ account: 'account_x' }, 'key', k.api)
  )
})
