import test from 'ava'
import { Writable } from 'stream'
import { FaableApi, FaableDeployment } from '../../../api/FaableApi'
import { follow_remote_build, format_build_warnings, unseen } from './follow'

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
    deployment_parent: parent({
      to: '3.13',
      deployment_id: 'deployment_clone'
    }),
    deployment_clone: {
      id: 'deployment_clone',
      status: {
        phase: 'BUILD_ERROR',
        reason: 'Command error: pip install (3.13)'
      }
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

// backlog §390: the build log replaced the detect log and was printed from the
// detect log's offset, so its head never showed ("dded 68 packages").
const replay = (polls: string[]): string => {
  let printed = 0
  let tail = ''
  let out = ''
  for (const content of polls) {
    out += unseen(content, printed, tail).text
    printed = content.length
    tail = content.slice(-200)
  }
  return out
}

test('unseen: a growing buffer prints only what is new', t => {
  t.is(replay(['line 1\n', 'line 1\nline 2\n']), 'line 1\nline 2\n')
})

test('unseen: a rotated buffer that kept the tail prints after it, no repeats', t => {
  const head = 'x'.repeat(300) + '\n'
  const first = head + 'step A\n'
  // keep-tail drops the head and keeps far more than the 200-char tail we
  // match on (it keeps megabytes); if it ever kept less, the buffer reads as
  // new and prints whole: a repeat beats a gap.
  const rotated = first.slice(50) + 'step B\n'
  t.is(replay([first, rotated]), first + 'step B\n')
})

test('unseen: a different buffer (build log after detect log) prints whole', t => {
  const detect =
    'INFO 🧩 Build plan {"buildpack":"node"}\nINFO ✅ Plan reported — the build Job takes it from here\n'
  const build =
    'INFO 📦 node_modules missing — installing dependencies\n\nadded 68 packages in 2s\nINFO ⚡️ No build step\n'
  const shown = replay([detect, build])
  t.true(shown.includes('INFO 📦 node_modules missing'))
  t.true(shown.includes('\nadded 68 packages in 2s'))
  t.false(shown.includes('\ndded 68'))
})

test('unseen: a different buffer longer than the first still prints from its start', t => {
  const detect = 'short detect log\n'
  const build = 'added 68 packages in 2s\n' + 'y'.repeat(400) + '\n'
  t.true(replay([detect, build]).endsWith(build))
})

// The build's warnings close the follow, after the log they would scroll away in.
test('a READY build with warnings prints them last and returns them', async t => {
  const build_warnings = [
    {
      code: 'install_legacy_peer_deps',
      message: 'npm could not resolve your peer dependencies (ERESOLVE).'
    }
  ]
  const { api } = fake_api({
    deployment_x: {
      id: 'deployment_x',
      status: { phase: 'READY' },
      build_warnings
    }
  })
  let written = ''
  const out = new Writable({
    write(chunk, _enc, done) {
      written += String(chunk)
      done()
    }
  })

  const landed = await follow_remote_build(api, 'deployment_x', out)

  t.deepEqual(landed, { id: 'deployment_x', build_warnings })
  t.regex(written, /1 build warning — /)
  t.regex(written, /• npm could not resolve your peer dependencies/)
})

test('no warnings, nothing printed', t => {
  t.is(format_build_warnings([]), '')
  t.is(format_build_warnings(undefined), '')
})
