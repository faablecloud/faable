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
