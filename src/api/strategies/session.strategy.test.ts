import test from 'ava'
import { session_strategy } from './session.strategy'

// A JWT whose `exp` is `secs` from now (only the payload matters here).
const jwt = (secs: number) =>
  `h.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + secs })).toString('base64url')}.s`

test('a live token is used as it is, nothing is read', async t => {
  const live = jwt(3600)
  let loads = 0
  const s = session_strategy({
    token: live,
    load: async () => (loads++, undefined)
  })
  t.deepEqual(await s.headers(), { Authorization: `Bearer ${live}` })
  t.is(loads, 0)
})

test('an expired token is refreshed mid-command, once for every request of that moment', async t => {
  const fresh = jwt(3600)
  let loads = 0
  const s = session_strategy({
    token: jwt(-60),
    load: async () => {
      loads++
      await new Promise(r => setTimeout(r, 20))
      return { token: fresh } as never
    }
  })
  const all = await Promise.all([s.headers(), s.headers(), s.headers()])
  t.is(loads, 1, 'one refresh in flight, shared')
  for (const h of all) t.is(h.Authorization, `Bearer ${fresh}`)
  await s.headers()
  t.is(loads, 1, 'the refreshed token is live: no more reads')
})

test('a refresh that brings nothing keeps the old token (the 401 says why)', async t => {
  const dead = jwt(-60)
  const s = session_strategy({ token: dead, load: async () => undefined })
  t.is((await s.headers()).Authorization, `Bearer ${dead}`)
})
