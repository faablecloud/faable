import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { promisify } from 'node:util'
import test from 'ava'

// `faable deploy app_xxx secrets list` used to DEPLOY: the `[app_id]`
// positional swallowed the id, the trailing `secrets list` went nowhere, and
// the deploy handler ran against the current directory. The only guard was an
// interactive prompt — invisible to CI and routinely accepted by agents
// driving the CLI. `deploy` now takes subcommands only; an app id goes in
// --app, and a stray one is an unknown command.
//
// Driven through the real CLI entrypoint (the wiring under test is yargs',
// not ours). `--json` keeps the banner and the update check — the only
// network in this path — switched off; every case here fails during
// validation, so nothing is ever deployed.
const exec_file = promisify(execFile)
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..'
)

const run = async (args: string[]) => {
  try {
    const { stdout, stderr } = await exec_file(
      process.execPath,
      ['--import', 'tsx', path.join(root, 'src/index.ts'), ...args, '--json'],
      { cwd: root, env: { ...process.env, NO_COLOR: '1' } }
    )
    return { code: 0, output: `${stdout}${stderr}` }
  } catch (error) {
    const failed = error as { code?: number; stdout?: string; stderr?: string }
    return {
      code: failed.code ?? 1,
      output: `${failed.stdout ?? ''}${failed.stderr ?? ''}`
    }
  }
}

test('an app id where a subcommand belongs fails, it does not deploy', async t => {
  const { code, output } = await run([
    'deploy',
    'app_6101a01869b888003a75a4b6',
    'secrets',
    'list'
  ])

  t.is(code, 1)
  t.regex(output, /Unknown command/)
  t.regex(output, /app_6101a01869b888003a75a4b6/)
  t.notRegex(output, /Deploying/)
  // The failure has to teach the flag, or it reads as a lost feature.
  t.regex(
    output,
    /faable deploy --app app_6101a01869b888003a75a4b6 \[subcommand\]/
  )
})

test('a bare app id fails too', async t => {
  const { code, output } = await run(['deploy', 'app_6101a01869b888003a75a4b6'])

  t.is(code, 1)
  t.regex(output, /Unknown command/)
  t.notRegex(output, /Deploying/)
})

test('--app is the documented way to target another app', async t => {
  const { code, output } = await run(['deploy', '--help'])

  t.is(code, 0)
  t.regex(output, /-a, --app/)
  // No positional in the usage line — that is the whole point.
  t.notRegex(output, /deploy \[app_id\]/)
})
