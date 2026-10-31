import test from 'ava'
import { waitForTask } from './task_wait'

const t0 = {
  id: 'task_1',
  app_id: 'app_1',
  deployment_id: 'deployment_1',
  argv: ['wp', 'plugin', 'list'],
  reason: null,
  exit_code: null,
  output_tail: null,
  timeout_s: 900,
  started_at: null,
  finished_at: null
}

test('waitForTask polls until a terminal status and reports each change once', async t => {
  const seq = ['queued', 'queued', 'running', 'running', 'succeeded'] as const
  let i = 0
  const seen: string[] = []
  const done = await waitForTask(
    async () => ({ ...t0, status: seq[Math.min(i++, seq.length - 1)] }),
    { sleep: async () => {}, onStatus: s => seen.push(s) }
  )
  t.is(done.status, 'succeeded')
  t.deepEqual(seen, ['queued', 'running', 'succeeded'])
})

test('waitForTask stops on failure too', async t => {
  const done = await waitForTask(
    async () => ({ ...t0, status: 'failed' as const, exit_code: 2 }),
    { sleep: async () => {} }
  )
  t.is(done.exit_code, 2)
})
