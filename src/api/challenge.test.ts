import test from 'ava'
import {
  ChallengeApi,
  challenge_error,
  requireChallengeToken,
  resolveSite
} from './challenge'

const SITE = {
  id: 'site_0123456789abcdef01234567',
  project_id: 'project_65a66419863cb24b65b5bd40',
  name: 'Contact form',
  domains: ['example.com'],
  site_key: 'fcs_pk_abc',
  secret_rotated_at: '2026-11-18T00:00:00.000Z',
  created_at: '2026-11-18T00:00:00.000Z',
  updated_at: '2026-11-18T00:00:00.000Z'
}

const recorder = (status: number, body?: unknown) => {
  const calls: { url: string; init: Parameters<typeof fetch>[1] & object }[] =
    []
  const doFetch = (async (
    url: string,
    init: Parameters<typeof fetch>[1] & object
  ) => {
    calls.push({ url, init })
    return new Response(status === 204 ? null : JSON.stringify(body ?? {}), {
      status,
      headers: { 'content-type': 'application/json' }
    })
  }) as unknown as typeof fetch
  return { calls, doFetch }
}

test('each call goes to the service with the bearer and the JSON body', async t => {
  const { calls, doFetch } = recorder(201, { ...SITE, secret: 'fcs_sk_x' })
  const api = new ChallengeApi('tok', 'https://ch.test', doFetch)
  const site = await api.createSite(SITE.project_id, {
    name: 'web',
    domains: ['example.com']
  })
  t.is(site.secret, 'fcs_sk_x')
  t.is(calls[0].url, `https://ch.test/v1/projects/${SITE.project_id}/sites`)
  t.is(calls[0].init.method, 'POST')
  const headers = calls[0].init.headers as Record<string, string>
  t.is(headers.authorization, 'Bearer tok')
  t.is(headers['content-type'], 'application/json')
  t.deepEqual(JSON.parse(String(calls[0].init.body)), {
    name: 'web',
    domains: ['example.com']
  })
})

test('the rest of the routes: patch, delete (204), rotate, usage', async t => {
  const p = SITE.project_id
  const cases: [
    (api: ChallengeApi) => Promise<unknown>,
    string,
    string,
    number
  ][] = [
    [
      a => a.updateSite(p, SITE.id, { name: 'x' }),
      'PATCH',
      `/sites/${SITE.id}`,
      200
    ],
    [a => a.deleteSite(p, SITE.id), 'DELETE', `/sites/${SITE.id}`, 204],
    [a => a.rotateSecret(p, SITE.id), 'POST', `/sites/${SITE.id}/secret`, 200],
    [a => a.getUsage(p), 'GET', '/usage', 200],
    [a => a.listSites(p), 'GET', '/sites', 200]
  ]
  for (const [call, method, suffix, status] of cases) {
    const { calls, doFetch } = recorder(status, { results: [] })
    await call(new ChallengeApi('tok', 'https://ch.test', doFetch))
    t.is(calls[0].init.method, method)
    t.is(calls[0].url, `https://ch.test/v1/projects/${p}${suffix}`)
  }
})

test("errors: the service's own message wins; its code passes through", async t => {
  const { doFetch } = recorder(402, {
    error: 'plan_required',
    message: 'Your free plan includes 1 Faable Challenge site.'
  })
  const api = new ChallengeApi('tok', 'https://ch.test', doFetch)
  const e = await t.throwsAsync(
    api.createSite(SITE.project_id, { name: 'a', domains: ['a.com'] })
  )
  t.is(e?.message, 'Your free plan includes 1 Faable Challenge site.')
  t.is((e as any).code, 'plan_required')
  t.is((e as any).status, 402)
})

test('errors: a bare code is said for a person; a dead token is session_expired', t => {
  const e = challenge_error(403, { error: 'role_required' })
  t.regex(e.message, /viewer/)
  t.is(e.code, 'role_required')
  t.is(challenge_error(401, { error: 'invalid_token' }).code, 'session_expired')
  t.is(challenge_error(404, undefined).code, 'not_found')
})

test('a deploy API key is refused before any request: Challenge takes a login', async t => {
  const e = await t.throwsAsync(
    requireChallengeToken({ FAABLE_API_KEY: 'k' } as typeof process.env)
  )
  t.is((e as any).code, 'apikey_session')
})

test('resolveSite: by id, by site key, by name; unknown and ambiguous are errors', async t => {
  const other = {
    ...SITE,
    id: 'site_ffffffffffffffffffffffff',
    site_key: 'fcs_pk_2'
  }
  const api = { listSites: async () => [SITE, other] }
  t.is((await resolveSite(api, 'p', SITE.id)).id, SITE.id)
  t.is((await resolveSite(api, 'p', 'fcs_pk_2')).id, other.id)
  const solo = { listSites: async () => [SITE] }
  t.is((await resolveSite(solo, 'p', 'contact FORM')).id, SITE.id)
  await t.throwsAsync(resolveSite(api, 'p', 'Contact form'), {
    message: /Several/
  })
  await t.throwsAsync(resolveSite(api, 'p', 'nope'), {
    message: /No Challenge site/
  })
})
