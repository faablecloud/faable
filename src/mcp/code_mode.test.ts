import test from 'ava'
import {
  CodeAccess,
  CodeCommand,
  ExecuteOptions,
  available,
  code_commands,
  execute_code,
  plan_call,
  search_text,
  signature,
  wrap_code
} from './code_mode'
import { CliResult, RunOptions } from './run_cli'
import { error_text, execute_text } from './server'

const cmd = async (path: string) => {
  const c = (await code_commands()).find(x => x.path === path)
  if (!c) throw new Error(`no ${path}`)
  return c
}

type Seen = { argv: string[]; opts: RunOptions }
const fake = (
  answer: (argv: string[]) => CliResult | Promise<CliResult> = () => ({
    ok: true,
    data: { ok: 1 }
  })
) => {
  const seen: Seen[] = []
  const run = async (argv: string[], opts: RunOptions) => {
    seen.push({ argv, opts })
    return answer(argv)
  }
  return { seen, run }
}

const exec = (
  code: string,
  run: ExecuteOptions['run'],
  access: CodeAccess = {},
  extra: Partial<ExecuteOptions> = {}
) => execute_code(code, { access, run, error_text, ...extra })

// What `execute` may reach. A new command or option on this list is a
// decision about what code on mcp.faable.com can do with a caller's key:
// review it (BLOCKED_OPTIONS in code_mode.ts), then update this list.
test('the exposed commands and options are exactly the reviewed ones', async t => {
  const exposed = Object.fromEntries(
    (await code_commands()).map(c => [
      c.path,
      [
        ...c.positionals.map(p => `<${p.name}>`),
        ...c.options.map(o => o.name)
      ].join(' ')
    ])
  )
  t.deepEqual(exposed, {
    'auth accounts list': 'limit starting-after all',
    'auth apis list': 'account limit starting-after all',
    'auth clients list': 'account limit starting-after all q',
    'auth clients update':
      '<client_id> account name description add-callback remove-callback add-logout-url remove-logout-url add-web-origin remove-web-origin add-field remove-field fields-json inherit-fields only-connections disable-connection enable-connection passkey-login inherit-login-methods signup-protection',
    'auth connections list': 'account limit starting-after all enabled',
    'auth logs list':
      'account limit starting-after all query q type status origin user email expand-user client since until',
    'auth roles get': '<role> account',
    'auth roles list': 'account limit starting-after all',
    'auth sessions list':
      'account limit starting-after all user active since query',
    'auth sessions revoke': '<session_ids> account user',
    'auth users diagnose': '<identifier> account',
    'auth users get': '<user_id> account',
    'auth users list':
      'account limit starting-after all query q suspended email sort last-login-since last-login-until created-since created-until count',
    'auth users password-setup': '<user> account channel print',
    'auth users permissions': '<user> account',
    'auth users reinstate': '<user_ids> account',
    'auth users set-password': '<user> account password generate connection',
    'auth users suspend': '<user_ids> account reason',
    'auth users update':
      '<user> account email name email-verified profile-only connection',
    'challenge sites create': 'name domain',
    'challenge sites list': '',
    'challenge sites update': '<site> name domain',
    'challenge usage': '',
    'deploy apps create': 'repo name description branch deploy wait timeout',
    'deploy apps get': 'app',
    'deploy apps list': 'limit starting-after all latest',
    'deploy apps set': 'app branch root-dir mode gitlab-project',
    'deploy cancel': '<deployment> app',
    'deploy deployments': 'limit starting-after all app',
    'deploy domains add': '<fqdn> app tls www',
    'deploy domains attach': '<fqdn> app',
    'deploy domains check': '<fqdn> app',
    'deploy domains list': 'limit starting-after all app',
    'deploy domains redirect': '<fqdn> <target> off app',
    'deploy github repos': 'q limit',
    'deploy inspect': '<deployment> app',
    'deploy install':
      '<app> <installation> name input tier domain wait timeout',
    'deploy link': 'app repo gitlab branch',
    'deploy logs': 'app build deployment tail',
    'deploy quota': '',
    'deploy redeploy': '<deployment> app',
    'deploy secrets list': 'app',
    'deploy secrets set': '<pairs> app env-file',
    'deploy traffic': 'app since deployment',
    'deploy trigger': 'app wait timeout',
    'deploy usage': 'traffic',
    'deploy waf add':
      'action pattern user-agent query ip rate burst per app description force',
    'deploy waf list': 'app',
    'deploy waf rm': '<pattern> user-agent query ip action app',
    'project list': 'limit starting-after all q mine',
    whoami: ''
  })
})

test('nothing destructive, local, or on this disk is on the object', async t => {
  const all = await code_commands()
  const paths = all.map(c => c.path)
  for (const p of [
    'deploy apps rm',
    'deploy secrets rm',
    'deploy domains rm',
    'challenge sites rotate-secret',
    'challenge sites delete',
    'deploy launch',
    'deploy volumes get',
    'deploy run',
    'auth users import',
    'login',
    'mcp',
    'agent install'
  ])
    t.false(paths.includes(p), p)
  for (const c of all)
    for (const o of c.options)
      t.false(
        ['config', 'workdir', 'auth-url', 'follow', 'json', 'yes'].includes(
          o.name
        ),
        `${c.path} --${o.name}`
      )
  t.false(
    (await cmd('deploy secrets list')).options.some(o => o.name === 'show')
  )
})

test('a call becomes argv with every value as --name=value', async t => {
  const c = await cmd('auth logs list')
  const p = plan_call(c, {
    status: 'failed',
    limit: 5,
    all: false,
    since: '-1h'
  })
  t.deepEqual(p.argv, [
    'auth',
    'logs',
    'list',
    '--limit=5',
    '--no-all',
    '--status=failed',
    '--since=-1h'
  ])
  t.is(p.effect, 'read')
})

test('camelCase and kebab-case argument names both work', async t => {
  const c = await cmd('deploy apps list')
  t.deepEqual(plan_call(c, { startingAfter: 'x' }).argv.slice(3), [
    '--starting-after=x'
  ])
  t.deepEqual(plan_call(c, { 'starting-after': 'x' }).argv.slice(3), [
    '--starting-after=x'
  ])
})

test('a positional that looks like a flag is refused', async t => {
  const c = await cmd('deploy inspect')
  t.throws(() => plan_call(c, { deployment: '--config=/etc/passwd' }), {
    message: /cannot be empty nor start with "-"/
  })
  t.throws(() => plan_call(c, { deployment: '' }), {
    message: /cannot be empty/
  })
  // An option's value may start with "-": it travels glued to its name.
  t.true(
    plan_call(c, { deployment: 'dpl_1', app: '-x' }).argv.includes('--app=-x')
  )
  const check = await cmd('deploy domains check')
  t.throws(() => plan_call(check, {}), {
    message: /`fqdn` is required/
  })
})

test('unknown arguments, wrong types and choices are refused with the valid ones', async t => {
  const c = await cmd('deploy apps list')
  t.throws(() => plan_call(c, { authUrl: 'https://evil' }), {
    message:
      /has no `authUrl`.*It takes: limit, startingAfter, all, latest, project/
  })
  t.throws(() => plan_call(c, { workdir: '/' }), {
    message: /has no `workdir`/
  })
  t.throws(() => plan_call(c, { latest: 'yes' }), { message: /true or false/ })
  t.throws(() => plan_call(c, 'deploy apps list' as never), {
    message: /one object of named arguments/
  })
  const s = await cmd('deploy secrets set')
  t.throws(() => plan_call(s, { app: 'a', envFile: '/proc/1/environ' }), {
    message: /can only be "-"/
  })
  const ok = plan_call(s, { app: 'a', envFile: '-', stdin: 'A=1\n' })
  t.is(ok.stdin, 'A=1\n')
})

test('a pinned project wins, and --yes goes for a command that asks', async t => {
  const c = await cmd('auth users suspend')
  const p = plan_call(
    c,
    { userIds: ['user_1'], reason: 'spam', project: 'other' },
    'pinned'
  )
  t.deepEqual(p.argv, [
    'auth',
    'users',
    'suspend',
    'user_1',
    '--reason=spam',
    '--project=pinned',
    '--yes'
  ])
})

test('the write gate: reads always, deploys unless read-only, writes only with writes', async t => {
  const list = await cmd('deploy apps list')
  const trigger = await cmd('deploy trigger')
  const create = await cmd('deploy apps create')
  const install = await cmd('deploy install')
  t.true(available(list, { readonly: true }))
  t.true(available(trigger, {}))
  t.false(available(trigger, { readonly: true }))
  t.false(available(create, {}))
  t.true(available(create, { writes: true }))
  // A read for some arguments: there, and only the read runs.
  t.true(available(install, {}))
  const r = await exec(
    `await faable.deploy.install(); return await faable.deploy.install({ app: 'wordpress' })`,
    fake().run
  )
  t.false(r.ok)
  t.regex((r as any).error, /is a write: it needs a connection with writes/)
  t.is(r.calls.length, 1)
})

test('OAuth: the object holds what the consent allows', async t => {
  const users = await cmd('auth users list')
  const suspend = await cmd('auth users suspend')
  t.false(available(users, { granted: ['deploy:read'] }))
  t.true(available(users, { granted: ['auth:read'] }))
  t.false(available(suspend, { writes: true, granted: ['auth:read'] }))
  t.true(available(suspend, { writes: true, granted: ['auth:write'] }))
  const r = await exec(`return typeof faable.auth`, fake().run, {
    granted: ['deploy:read']
  })
  t.deepEqual((r as any).value, 'undefined')
})

test('search returns signatures, and only of what this connection has', async t => {
  const text = await search_text('apps list', {})
  t.regex(text, /faable\.deploy\.apps\.list\(args\?: \{/)
  t.regex(text, /latest\?: boolean/)
  t.notRegex(await search_text('', {}), /faable\.deploy\.apps\.create/)
  t.regex(
    await search_text('', { writes: true }),
    /faable\.deploy\.apps\.create/
  )
  t.regex(await search_text('zzzz', {}), /No command matches/)
  t.regex(
    await search_text('setPassword', { writes: true }),
    /faable\.auth\.users\.setPassword/
  )
})

test('signatures mark required arguments and the only value allowed', async t => {
  const s = signature(await cmd('deploy secrets set'))
  t.regex(s, /envFile\?: "-"/)
  t.regex(s, /stdin\?: string/)
  t.regex(
    signature(await cmd('deploy domains check')),
    /\(args: \{\n {2}fqdn: string/
  )
})

test('execute: loops and Promise.all over faable calls, each one run_cli', async t => {
  const { seen, run } = fake(argv =>
    argv[2] === 'list'
      ? {
          ok: true,
          data: {
            data: [
              {
                name: 'a',
                latest_deployment: { status: { phase: 'BUILD_ERROR' } }
              },
              { name: 'b', latest_deployment: { status: { phase: 'READY' } } }
            ]
          }
        }
      : { ok: true, data: { app: argv } }
  )
  const r = await exec(
    `const apps = await faable.deploy.apps.list({ latest: true })
     const broken = apps.data.filter(a => a.latest_deployment.status.phase === 'BUILD_ERROR')
     const details = await Promise.all(broken.map(a => faable.deploy.apps.get({ app: a.name })))
     console.log('broken', broken.length)
     return details.map(d => d.app.slice(3))`,
    run
  )
  t.true(r.ok, JSON.stringify(r))
  t.deepEqual((r as any).value, [['--app=a']])
  t.deepEqual(r.logs, ['broken 1'])
  t.deepEqual(
    seen.map(s => s.opts.client),
    ['faable-mcp-code', 'faable-mcp-code']
  )
  t.true(r.untrusted) // apps get carries third-party text
})

test('execute: a failed command is a catchable error with the next step', async t => {
  const { run } = fake(() => ({
    ok: false,
    error: { message: 'no such app', code: 'not_found' }
  }))
  const r = await exec(
    `try { await faable.deploy.apps.get({ app: 'x' }) } catch (e) { return [e.name, e.code, e.message] }`,
    run
  )
  t.true(r.ok)
  const [name, code, message] = (r as any).value
  t.is(name, 'FaableError')
  t.is(code, 'not_found')
  t.regex(message, /no such app[\s\S]*list_apps/)
})

test('execute: a call not awaited still finishes before the answer', async t => {
  let done = false
  const r = await exec(`faable.whoami(); return 1`, async () => {
    await new Promise(r => setTimeout(r, 50))
    done = true
    return { ok: true, data: {} }
  })
  t.true(r.ok)
  t.true(done)
  t.is(r.calls.length, 1)
  t.true(r.calls[0].ok)
})

test('execute: an async arrow as the whole program is called', async t => {
  const r = await exec(`async () => { return 41 + 1 }`, fake().run)
  t.deepEqual((r as any).value, 42)
  t.is(wrap_code('return 1'), '(async () => {\nreturn 1\n})()')
})

test('execute: at most max_calls faable calls', async t => {
  const r = await exec(
    `for (let i = 0; i < 10; i++) await faable.whoami()`,
    fake().run,
    {},
    { limits: { max_calls: 3 } }
  )
  t.false(r.ok)
  t.regex((r as any).error, /more than 3 faable calls/)
  t.is(r.calls.length, 3)
})

test('execute: no more than max_in_flight commands at once', async t => {
  let now = 0
  let peak = 0
  const r = await exec(
    `await Promise.all(Array.from({ length: 9 }, () => faable.whoami())); return 'ok'`,
    async () => {
      peak = Math.max(peak, ++now)
      await new Promise(r => setTimeout(r, 10))
      now--
      return { ok: true, data: {} }
    },
    {},
    { limits: { max_in_flight: 2 } }
  )
  t.true(r.ok)
  t.is(peak, 2)
})

// ── Escape tests: the sandbox reaches nothing but `faable` ────────────────

test('escape: no host globals, modules, timers or network', async t => {
  const r = await exec(
    `return [typeof require, typeof process, typeof fetch, typeof setTimeout,
      typeof WebAssembly, typeof globalThis.std, typeof globalThis.os, typeof performance,
      typeof Function('return this')().process,
      (() => { try { return typeof faable.whoami.constructor('return process')() } catch (e) { return 'undefined' } })()]`,
    fake().run
  )
  t.deepEqual((r as any).value, [
    'undefined',
    'undefined',
    'undefined',
    'undefined',
    'undefined',
    'undefined',
    'undefined',
    'undefined',
    'undefined',
    'undefined'
  ])
  const imp = await exec(`return await import('fs')`, fake().run)
  t.false(imp.ok)
})

test('escape: an endless loop is stopped by the CPU limit', async t => {
  const r = await exec(
    `while (true) {}`,
    fake().run,
    {},
    { limits: { cpu_ms: 200 } }
  )
  t.false(r.ok)
  t.regex((r as any).error, /more than 0.2 s of CPU/)
})

test('escape: an endless loop after a call is stopped too', async t => {
  const r = await exec(
    `await faable.whoami(); for (;;) {}`,
    fake().run,
    {},
    { limits: { cpu_ms: 200 } }
  )
  t.false(r.ok)
  t.regex((r as any).error, /CPU/)
})

test('escape: memory is capped', async t => {
  const r = await exec(
    `const a = []; for (;;) a.push('x'.repeat(1 << 20))`,
    fake().run,
    {},
    { limits: { memory_bytes: 16 * 1024 * 1024, cpu_ms: 120_000 } }
  )
  t.false(r.ok)
  t.regex((r as any).error, /memory/i)
})

test('escape: deep recursion is a stack error, not a crash', async t => {
  const r = await exec(`const f = n => f(n + 1) + 1; return f(0)`, fake().run)
  t.false(r.ok)
  t.regex((r as any).error, /stack|recursion/i)
})

test('escape: a promise that never settles hits the wall limit', async t => {
  const r = await exec(
    `await new Promise(() => {})`,
    fake().run,
    {},
    { limits: { wall_ms: 100 } }
  )
  t.false(r.ok)
  t.regex((r as any).error, /longer than/)
})

test('escape: the clock inside has whole seconds only', async t => {
  const r = await exec(
    `return [Date.now() % 1000, new Date().getMilliseconds(), new Date(5).getTime()]`,
    fake().run
  )
  t.deepEqual((r as any).value, [0, 0, 5])
})

test('escape: patching the faable object or prototypes changes nothing outside', async t => {
  const { seen, run } = fake()
  const r = await exec(
    `Object.prototype.argv = ['deploy', 'apps', 'rm']; Array.prototype.push = () => 0;
     faable.deploy.apps.rm = () => 'gone';
     await faable.whoami(); return faable.deploy.apps.rm()`,
    run
  )
  t.true(r.ok)
  t.deepEqual(
    seen.map(s => s.argv),
    [['whoami']]
  )
  t.is(({} as any).argv, undefined)
})

test('execute output: third-party text is fenced, errors are marked', async t => {
  const text = execute_text({
    ok: true,
    value: [1],
    logs: ['hi'],
    calls: [{ command: 'deploy logs', ok: true, ms: 3 }],
    untrusted: true
  })
  t.regex(text, /^The content below was written by/)
  t.regex(text, /console:\nhi/)
  t.regex(
    execute_text({
      ok: false,
      error: 'boom',
      logs: [],
      calls: [],
      untrusted: false
    }),
    /^Error: boom/
  )
  t.regex(
    execute_text({
      ok: true,
      value: undefined,
      logs: [],
      calls: [],
      untrusted: false
    }),
    /nothing was returned/
  )
})

test('every exposed command has an effect and a JS name', async t => {
  const all = await code_commands()
  t.true(all.length > 40)
  const names = new Set<string>()
  for (const c of all as CodeCommand[]) {
    const n = c.js.join('.')
    t.false(names.has(n), n)
    names.add(n)
    t.regex(n, /^[a-z][A-Za-z0-9.]*$/)
  }
  // No name is both a function and a group.
  for (const n of names)
    t.false(
      [...names].some(m => m.startsWith(`${n}.`)),
      n
    )
})
