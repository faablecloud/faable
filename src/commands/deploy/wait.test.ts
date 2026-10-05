import test from 'ava'
import { wait_for_deployment } from './wait'

const fakeApi = (phases: string[], fault?: any) => {
  let i = 0
  return {
    calls: () => i,
    api: {
      getDeployment: async () => ({
        status: {
          phase: phases[Math.min(i++, phases.length - 1)],
          reason: 'npm run build exited 1'
        }
      }),
      getDeploymentFault: async () => {
        if (!fault) throw { response: { status: 404 } }
        return fault
      }
    } as any
  }
}

const clock = () => {
  let t = 0
  return { now: () => t, sleep: async (ms: number) => void (t += ms) }
}

test('waits through the build and hands back the URL on READY', async t => {
  const f = fakeApi(['QUEUED', 'BUILDING', 'INITIALIZING', 'READY'])
  const r = await wait_for_deployment(
    f.api,
    'deployment_1',
    { timeout_s: 600, app_url: 'https://web.faable.link' },
    clock()
  )
  t.deepEqual(r, {
    deployment_id: 'deployment_1',
    phase: 'READY',
    done: true,
    ok: true,
    url: 'https://web.faable.link'
  })
})

test('a failure comes back with its reason and whose fault it is', async t => {
  const f = fakeApi(['BUILDING', 'BUILD_ERROR'], {
    fault_owner: 'user',
    error_code: 'user_build_command_failed'
  })
  const r = await wait_for_deployment(f.api, 'd', { timeout_s: 600 }, clock())
  t.like(r, {
    phase: 'BUILD_ERROR',
    done: true,
    ok: false,
    reason: 'npm run build exited 1',
    fault_owner: 'user',
    error_code: 'user_build_command_failed'
  })
  t.is(r.url, undefined)
})

test('an api without /fault still answers, without a verdict', async t => {
  const f = fakeApi(['ERROR'])
  const r = await wait_for_deployment(f.api, 'd', { timeout_s: 60 }, clock())
  t.like(r, { phase: 'ERROR', done: true })
  t.false('fault_owner' in r)
})

test('the timeout returns the phase it reached, not an error', async t => {
  const f = fakeApi(['BUILDING'])
  const c = clock()
  const r = await wait_for_deployment(
    f.api,
    'd',
    { timeout_s: 30 },
    { ...c, poll_ms: 5_000 }
  )
  t.deepEqual(r, { deployment_id: 'd', phase: 'BUILDING', done: false, ok: false })
  t.true(c.now() >= 30_000 && c.now() <= 35_000)
})
