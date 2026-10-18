import test from 'ava'
import { Writable } from 'stream'
import { FaableApi, FaableDeployment } from '../../../api/FaableApi'
import { follow_remote_build } from './follow'

// backlog §379: when the platform already retried a failed build on the
// previous Python (api runtime_fallback.plugin, runtime-versions.md §12), the
// CLI follows the clone instead of exiting red for a deploy about to succeed.

const sink = () =>
  new Writable({
    write(_chunk, _enc, done) {
      done()
    }
  })

const fake_api = (rows: Record<string, FaableDeployment>) => {
  const asked: string[] = []
  const api = {
    getDeployment: async (id: string) => {
      asked.push(id)
      return rows[id]
    },
    getDeploymentLogs: async () => ({ content: '' })
  } as unknown as FaableApi
  return { api, asked }
}

const parent = (retry?: FaableDeployment['runtime_fallback_retry']) => ({
  id: 'deployment_parent',
  status: {
    phase: 'BUILD_ERROR',
    reason: 'Command error: pip install --no-cache-dir -r requirements.txt'
  },
  runtime_fallback_retry: retry
})

test('a build the platform retried is followed to its clone, whose id is returned', async t => {
  const { api, asked } = fake_api({
    deployment_parent: parent({ to: '3.13', deployment_id: 'abc123' }),
    deployment_abc123: { id: 'deployment_abc123', status: { phase: 'READY' } }
  })

  const landed = await follow_remote_build(api, 'deployment_parent', sink())

  t.deepEqual(landed, { id: 'deployment_abc123' })
  t.true(asked.includes('deployment_abc123'), 'the bare hex id is prefixed')
})

test('a failure without a retry still exits red with its reason', async t => {
  const { api } = fake_api({ deployment_parent: parent() })
  await t.throwsAsync(follow_remote_build(api, 'deployment_parent', sink()), {
    message: /^Remote build failed: Command error: pip install/
  })
})

test('a retry that fails too exits red with the retry’s reason', async t => {
  const { api } = fake_api({
    deployment_parent: parent({ to: '3.13', deployment_id: 'deployment_clone' }),
    deployment_clone: {
      id: 'deployment_clone',
      status: { phase: 'BUILD_ERROR', reason: 'Command error: pip install (3.13)' }
    }
  })
  await t.throwsAsync(follow_remote_build(api, 'deployment_parent', sink()), {
    message: /\(3\.13\)/
  })
})

test('the claim alone (no clone yet) is not a retry to follow', async t => {
  const { api } = fake_api({ deployment_parent: parent({ to: '3.13' }) })
  await t.throwsAsync(follow_remote_build(api, 'deployment_parent', sink()), {
    message: /^Remote build failed/
  })
})
