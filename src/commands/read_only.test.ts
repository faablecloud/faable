import test from 'ava'
import { execFile } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { ANA, APP, start_api } from '../test/stub_api'

// Read-only mode (src/lib/read_only.ts, arch/deploy/cli-code-mode-plan.md F3):
// with FAABLE_READONLY=1 a command that changes Faable is refused before it
// sends anything — not one request reaches the API — and a read goes through.
// Driven through the real entrypoint against the stub API, with an empty HOME
// so no real session is ever read.
const exec_file = promisify(execFile)
const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const root = path.resolve(src, '..')

const run = async (args: string[], env: Record<string, string>) => {
  const base: Record<string, string | undefined> = { ...process.env }
  for (const name of [
    'FAABLE_TOKEN',
    'FAABLE_API_KEY',
    'FAABLE_PROJECT',
    'FAABLE_READONLY',
    'GITHUB_ACTIONS'
  ])
    delete base[name]
  const home = mkdtempSync(path.join(os.tmpdir(), 'faable-home-'))
  try {
    const { stdout, stderr } = await exec_file(
      process.execPath,
      ['--import', 'tsx', path.join(src, 'index.ts'), ...args],
      { cwd: root, env: { ...base, HOME: home, NO_COLOR: '1', ...env } }
    )
    return { code: 0, stdout, stderr }
  } catch (error) {
    const failed = error as { code?: number; stdout?: string; stderr?: string }
    return {
      code: failed.code ?? 1,
      stdout: failed.stdout ?? '',
      stderr: failed.stderr ?? ''
    }
  }
}

const error_of = (stderr: string) =>
  JSON.parse(stderr.trim().split('\n').pop() ?? '{}').error ?? {}

const env_for = (url: string, extra: Record<string, string> = {}) => ({
  FAABLE_NONINTERACTIVE: '1',
  FAABLE_TOKEN: 'stub',
  FAABLE_API_URL: url,
  FAABLE_AUTH_URL: url,
  FAABLE_AUTH_ACCOUNT: 'account_test',
  ...extra
})

// One of each way a command is reached: plain, the group's default ($0), an
// alias, a hidden command, an effect that depends on the arguments, and
// Faable Auth.
const WRITES: string[][] = [
  ['deploy', 'secrets', 'rm', 'API_KEY', '--app', APP.id],
  ['deploy', 'domains', 'rm', 'www.example.com', '--app', APP.id],
  ['deploy', 'launch', '--app', APP.id, '--workdir', '.'],
  ['deploy', '--app', APP.id, '--workdir', '.'],
  ['org', 'admins', 'rm', 'org_x', 'user_x'],
  [
    'deploy',
    'waf',
    'add',
    '--action',
    'deny',
    '--pattern',
    '/x',
    '--app',
    APP.id
  ],
  ['deploy', 'install', 'wordpress'],
  ['auth', 'sessions', 'revoke', 'session_1'],
  ['auth', 'users', 'roles', ANA.id, '--add', 'admin']
]

for (const args of WRITES) {
  test(`FAABLE_READONLY=1 refuses \`faable ${args.join(' ')}\` before any request`, async t => {
    const api = await start_api()
    try {
      const { code, stdout, stderr } = await run(
        [...args, '--yes', '--json'],
        env_for(api.url, { FAABLE_READONLY: '1' })
      )
      t.is(code, 1)
      t.is(stdout, '')
      t.is(error_of(stderr).code, 'read_only', stderr)
      t.deepEqual(api.requests, [])
    } finally {
      api.close()
    }
  })
}

test('reads go through in read-only mode', async t => {
  const api = await start_api()
  try {
    for (const args of [
      ['deploy', 'apps', 'list'],
      ['deploy', 'secrets', 'list', '--app', APP.id]
    ]) {
      const { code, stderr } = await run(
        [...args, '--json'],
        env_for(api.url, { FAABLE_READONLY: '1' })
      )
      t.is(code, 0, `${args.join(' ')}: ${stderr}`)
    }
    t.deepEqual(api.writes, [])
  } finally {
    api.close()
  }
})

test('--read-only is the same as FAABLE_READONLY=1', async t => {
  const api = await start_api()
  try {
    const { code, stderr } = await run(
      [
        '--read-only',
        'deploy',
        'secrets',
        'rm',
        'API_KEY',
        '--app',
        APP.id,
        '--yes',
        '--json'
      ],
      env_for(api.url)
    )
    t.is(code, 1)
    t.is(error_of(stderr).code, 'read_only')
    t.deepEqual(api.requests, [])
  } finally {
    api.close()
  }
})

// The refusals above are the mode, not a stub that cannot take the write.
test('FAABLE_READONLY=0 is off: the same delete goes through', async t => {
  const api = await start_api()
  try {
    const { code, stderr } = await run(
      [
        'deploy',
        'domains',
        'rm',
        'www.example.com',
        '--app',
        APP.id,
        '--yes',
        '--json'
      ],
      env_for(api.url, { FAABLE_READONLY: '0' })
    )
    t.is(code, 0, stderr)
    t.deepEqual(api.writes, ['DELETE /domain/domain_1'])
  } finally {
    api.close()
  }
})
