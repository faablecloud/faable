import test from 'ava'
import { execFile } from 'node:child_process'
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync
} from 'node:fs'
import http from 'node:http'
import { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

// The contract a program driving the CLI relies on — the Faable MCP server
// sets FAABLE_NONINTERACTIVE=1 on every call (arch/deploy/mcp-cli-gaps.md):
//
//   - a confirmation without --yes is an error (`confirmation_required`,
//     exit 1), never a "Cancelled." with exit 0 that reads as success, and
//     the destructive call never reaches the API;
//   - failures are JSON on stderr with a stable `code`;
//   - a deploy needs --app, --workdir and --yes spelled out.
//
// Driven through the real entrypoint. The Deploy API is a local stub
// (FAABLE_API_URL) that records every write, and HOME is an empty temp dir so
// no real session is ever read.
const exec_file = promisify(execFile)
const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const root = path.resolve(src, '..')

const APP = {
  id: 'app_test',
  name: 'test-app',
  team: 'project_test',
  url: 'test-app.app.faable.com'
}

const start_api = async () => {
  const writes: string[] = []
  const bodies: string[] = []
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://stub')
    const json = (body: unknown) => {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(body))
    }
    if (req.method !== 'GET') {
      writes.push(`${req.method} ${req.url}`)
      let body = ''
      req.on('data', chunk => (body += chunk))
      req.on('end', () => {
        bodies.push(body)
        if (url.pathname === `/app/${APP.id}/deploy`) {
          return json({
            status: 'created',
            commit: 'abc1234def',
            branch: 'main'
          })
        }
        if (url.pathname === '/deployment/deployment_1/redeploy') {
          return json({ id: 'deployment_2', redeploy_of: 'deployment_1' })
        }
        if (url.pathname === '/domain') {
          return json({ id: 'domain_2', fqdn: 'www.new.example.com' })
        }
        json({})
      })
      return
    }
    if (url.pathname === `/app/${APP.id}`) return json(APP)
    if (url.pathname === `/app/${APP.id}/logs`) {
      return json([
        ['1700000001000000000', 'second'],
        ['1700000000000000000', 'first', 'stdout']
      ])
    }
    if (url.pathname === '/deployment') {
      return json({
        results: [{ id: 'deployment_1', status: { phase: 'BUILD_ERROR' } }],
        next: null
      })
    }
    if (url.pathname === '/deployment/deployment_1/logs') {
      return json({ content: 'one\ntwo\nthree\n', truncated: false })
    }
    if (url.pathname === `/secret/${APP.id}`) {
      return json({
        results: [{ name: 'API_KEY', value: 'secret', related_model: 'app' }],
        next: null
      })
    }
    if (url.pathname === '/domain') {
      return json({
        results: [{ id: 'domain_1', fqdn: 'www.example.com', verified: true }],
        next: null
      })
    }
    res.statusCode = 404
    json({ message: 'not found' })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    writes,
    bodies,
    close: () => server.close()
  }
}

const run = async (
  args: string[],
  env: Record<string, string> = {},
  input = ''
) => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'faable-home-'))
  // The caller's own session and CI context must not leak into the run.
  const base = { ...process.env }
  for (const name of [
    'FAABLE_TOKEN',
    'FAABLE_PROJECT',
    'FAABLE_NONINTERACTIVE',
    'GITHUB_ACTIONS'
  ]) {
    delete base[name]
  }
  try {
    const running = exec_file(
      process.execPath,
      ['--import', 'tsx', path.join(src, 'index.ts'), ...args],
      {
        cwd: root,
        env: { ...base, HOME: home, NO_COLOR: '1', ...env }
      }
    )
    running.child.stdin?.end(input)
    const { stdout, stderr } = await running
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

const error_of = (stderr: string) => {
  const line = stderr.trim().split('\n').pop() ?? ''
  return (JSON.parse(line) as { error: { code?: string; message: string } })
    .error
}

const NONINTERACTIVE = { FAABLE_NONINTERACTIVE: '1' }

test('no session: not_logged_in as JSON, with --json or in non-interactive mode', async t => {
  for (const [args, env] of [
    [['deploy', 'apps', 'list', '--json'], {}],
    [['deploy', 'apps', 'list'], NONINTERACTIVE]
  ] as const) {
    const { code, stdout, stderr } = await run([...args], env)
    t.is(code, 1)
    t.is(stdout, '', 'stdout stays data-only')
    t.is(error_of(stderr).code, 'not_logged_in')
  }
})

test('a bad invocation is a usage error, without the help screen', async t => {
  const { code, stderr } = await run(['deploy', 'nope'], NONINTERACTIVE)
  t.is(code, 1)
  t.is(error_of(stderr).code, 'usage')
  t.notRegex(stderr, /Commands:/)
})

test('deploy secrets rm / domains rm without --yes: refused, nothing deleted', async t => {
  const api = await start_api()
  try {
    const env = {
      ...NONINTERACTIVE,
      FAABLE_TOKEN: 'stub',
      FAABLE_API_URL: api.url
    }
    for (const args of [
      ['deploy', 'secrets', 'rm', 'API_KEY', '--app', APP.id],
      ['deploy', 'domains', 'rm', 'www.example.com', '--app', APP.id]
    ]) {
      const { code, stderr } = await run(args, env)
      t.is(code, 1, args.join(' '))
      t.is(error_of(stderr).code, 'confirmation_required', args.join(' '))
    }
    t.deepEqual(api.writes, [])

    // The same with --yes goes through: the refusal above is the prompt,
    // not a broken stub.
    const { code } = await run(
      ['deploy', 'domains', 'rm', 'www.example.com', '--app', APP.id, '--yes'],
      env
    )
    t.is(code, 0)
    t.deepEqual(api.writes, ['DELETE /domain/domain_1'])
  } finally {
    api.close()
  }
})

test('the reads an agent needs come out as data', async t => {
  const api = await start_api()
  try {
    const env = {
      ...NONINTERACTIVE,
      FAABLE_TOKEN: 'stub',
      FAABLE_API_URL: api.url
    }
    const read = async (args: string[]) => {
      const { code, stdout, stderr } = await run([...args, '--json'], env)
      t.is(code, 0, `${args.join(' ')}: ${stderr}`)
      return JSON.parse(stdout)
    }
    const app = ['--app', APP.id]

    const got = await read(['deploy', 'apps', 'get', ...app])
    t.is(got.id, APP.id)
    t.is(got.latest_deployment.id, 'deployment_1')

    const runtime = await read(['deploy', 'logs', ...app])
    t.is(runtime.object, 'list')
    t.deepEqual(
      runtime.data.map((l: { message: string }) => l.message),
      ['first', 'second']
    )

    t.deepEqual(await read(['deploy', 'logs', '--build', '-n', '1', ...app]), {
      deployment_id: 'deployment_1',
      content: 'three\n',
      truncated: false,
      omitted_lines: 2
    })

    const domain = await read([
      'deploy',
      'domains',
      'check',
      'www.example.com',
      ...app
    ])
    t.is(domain.expected_cname, 'domain_1.faable.link')
  } finally {
    api.close()
  }
})

test('the writes say what they did, and a no-op says so', async t => {
  const api = await start_api()
  try {
    const env = {
      ...NONINTERACTIVE,
      FAABLE_TOKEN: 'stub',
      FAABLE_API_URL: api.url
    }
    const write = async (args: string[], input = '') => {
      const { code, stdout, stderr } = await run(
        [...args, '--json'],
        env,
        input
      )
      t.is(code, 0, `${args.join(' ')}: ${stderr}`)
      return { data: JSON.parse(stdout), stdout }
    }
    const app = ['--app', APP.id]

    t.deepEqual((await write(['deploy', 'trigger', ...app])).data, {
      app_id: APP.id,
      status: 'created',
      commit: 'abc1234def',
      branch: 'main'
    })
    t.is((await write(['deploy', 'redeploy', ...app])).data.id, 'deployment_2')
    // The only deployment is a failed one: nothing in flight to cancel.
    t.is((await write(['deploy', 'cancel', ...app])).data.result, 'noop')

    const added = await write(
      ['deploy', 'domains', 'add', 'www.new.example.com', ...app],
      ''
    )
    t.is(added.data.expected_cname, 'domain_2.faable.link')

    // Values come in on stdin and only names come back out.
    const secret = 'sk_live_never_echoed'
    const set = await write(
      // `-f`, not `--env-file`: node ≥ 22 claims the long one (see set.ts).
      ['deploy', 'secrets', 'set', '-f', '-', ...app],
      `API_KEY=secret\nNEW_KEY=${secret}\n`
    )
    t.deepEqual(set.data, {
      app_id: APP.id,
      added: ['NEW_KEY'],
      updated: [],
      unchanged: ['API_KEY'],
      restarting: true
    })
    t.false(set.stdout.includes(secret))
    t.true(
      api.bodies.some(b => b.includes(secret)),
      'the value did reach the api'
    )
  } finally {
    api.close()
  }
})

test('auth users suspend / reinstate / import / export without --yes: refused before any request', async t => {
  const file = path.join(
    mkdtempSync(path.join(os.tmpdir(), 'faable-import-')),
    'users.ndjson'
  )
  writeFileSync(
    file,
    JSON.stringify({ user_id: 'auth0|1', email: 'a@example.com' }) + '\n'
  )
  for (const args of [
    ['auth', 'users', 'suspend', 'user_abc'],
    ['auth', 'users', 'reinstate', 'user_abc'],
    ['auth', 'users', 'import', file, '--from', 'auth0'],
    ['auth', 'users', 'export', '--include-hashes']
  ]) {
    const { code, stderr } = await run(args, NONINTERACTIVE)
    t.is(code, 1, args.join(' '))
    t.is(error_of(stderr).code, 'confirmation_required', args.join(' '))
  }
})

test('a deploy never infers its target or its go-ahead', async t => {
  for (const [args, code] of [
    [['deploy'], 'usage'],
    [
      ['deploy', 'launch', '--app', APP.id, '--workdir', root],
      'confirmation_required'
    ]
  ] as const) {
    const result = await run([...args], NONINTERACTIVE)
    t.is(result.code, 1, args.join(' '))
    t.is(error_of(result.stderr).code, code, args.join(' '))
  }
})

test('every confirmation goes through lib/interactive', t => {
  // A raw `prompts` toggle in a command would bring back the silent
  // "Cancelled." exit 0. Only the flows that ARE interactive keep their own.
  const allowed = new Set([
    'commands/login/index.ts',
    'commands/link/index.ts',
    'commands/project/picker.ts'
  ])
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap(name => {
      const p = path.join(dir, name)
      return statSync(p).isDirectory() ? walk(p) : [p]
    })
  const offenders = walk(path.join(src, 'commands'))
    .filter(p => p.endsWith('.ts') && !p.endsWith('.test.ts'))
    .filter(p => /from 'prompts'|from "prompts"/.test(readFileSync(p, 'utf8')))
    .map(p => path.relative(src, p))
    .filter(p => !allowed.has(p))
  t.deepEqual(offenders, [])
})
