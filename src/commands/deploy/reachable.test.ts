import test from 'ava'
import { reachable_timeout_ms, wait_reachable } from './reachable'

// F9 (arch/deploy/cli-mcp-fallos-2026-10-16-plan.md): `live` came back while
// the URL still gave the edge's 404 for about a minute.
const answer = (headers: Record<string, string>, status = 200) =>
  new Response('', { status, headers })
const clock = () => {
  let t = 0
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms
    }
  }
}

test("waits through the edge's APP_NOT_FOUND, then the app answers", async t => {
  const answers = [
    answer({ 'x-faable-error': 'APP_NOT_FOUND' }, 404),
    answer({ 'x-faable-error': 'APP_NOT_FOUND' }, 404),
    answer({}, 200)
  ]
  const urls: string[] = []
  const ok = await wait_reachable('https://web.faable.link', 60_000, {
    ...clock(),
    fetch: async url => {
      urls.push(url)
      return answers.shift()!
    }
  })
  t.true(ok)
  t.is(urls.length, 3)
  // The not-found answer is cacheable: every probe busts the cache.
  t.is(new Set(urls).size, 3)
})

test("an app's own 404 is an answer, not the edge's", async t => {
  t.true(
    await wait_reachable('https://web.faable.link', 60_000, {
      ...clock(),
      fetch: async () => answer({}, 404)
    })
  )
})

test('still not routed when time runs out: false, never a throw', async t => {
  t.false(
    await wait_reachable('https://web.faable.link', 10_000, {
      ...clock(),
      fetch: async () => {
        throw new Error('ECONNRESET')
      }
    })
  )
})

test('FAABLE_REACHABLE_TIMEOUT_MS: default 120 s, 0 turns it off', t => {
  t.is(reachable_timeout_ms({}), 120_000)
  t.is(reachable_timeout_ms({ FAABLE_REACHABLE_TIMEOUT_MS: '0' }), 0)
  t.is(reachable_timeout_ms({ FAABLE_REACHABLE_TIMEOUT_MS: 'nope' }), 120_000)
})
