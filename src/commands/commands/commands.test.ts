import test from 'ava'
import { execFile } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

// `faable commands` is what an agent searches before it calls anything
// (arch/deploy/cli-code-mode-plan.md, F1): driven through the real entrypoint,
// with no session — describing the CLI never needs one.
const exec_file = promisify(execFile)
const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

const run = async (...args: string[]) => {
  const env: Record<string, string | undefined> = {
    ...process.env,
    NO_COLOR: '1',
    HOME: '/nonexistent'
  }
  delete env.FAABLE_TOKEN
  const { stdout } = await exec_file(
    process.execPath,
    ['--import', 'tsx', path.join(src, 'index.ts'), 'commands', ...args],
    { env, maxBuffer: 16 << 20 }
  )
  return stdout
}

const list = async (...args: string[]) =>
  JSON.parse(await run(...args, '--json')) as {
    object: string
    data: any[]
    has_more: boolean
    global_options: { name: string }[]
  }

test('--json: the listing envelope, one object per command', async t => {
  const out = await list()
  t.is(out.object, 'list')
  t.false(out.has_more)
  t.true(out.data.length > 100)
  t.true(out.data.every(c => c.object === 'command' && c.effect))
  t.deepEqual(
    out.global_options.map(o => o.name),
    ['project', 'non-interactive', 'config']
  )
})

test('a search finds the command with what it takes to call it', async t => {
  const { data } = await list('domain', 'add')
  t.deepEqual(
    data.map(c => c.path),
    ['deploy domains add']
  )
  const [add] = data
  t.is(add.usage, 'faable deploy domains add <fqdn>')
  t.is(add.effect, 'write')
  t.true(add.json)
  t.like(add.positionals[0], { name: 'fqdn', required: true })
  t.like(
    add.options.find((o: any) => o.name === 'app'),
    { aliases: ['a'], type: 'string' }
  )
  // --json is the `json` field, not one more option to read.
  t.false(add.options.some((o: any) => o.name === 'json'))
})

test('--effect read lists only what changes nothing', async t => {
  const { data } = await list('--effect', 'read')
  t.true(data.length > 40)
  t.true(data.every(c => c.effect === 'read'))
  t.true(data.some(c => c.path === 'deploy logs'))
})

test('an effect that depends on the arguments says when it is a read', async t => {
  const { data } = await list('install', 'catalogue')
  const install = data.find(c => c.path === 'deploy install')
  t.is(install.effect, 'write')
  t.regex(install.read_when, /without <app>/)
})

test('hidden commands only with --hidden', async t => {
  const visible = await list('waf')
  t.false(visible.data.some(c => c.path === 'deploy waf add'))
  const all = await list('waf', '--hidden')
  t.like(
    all.data.find(c => c.path === 'deploy waf add'),
    { hidden: true, effect: 'write' }
  )
})

test('the default of a group is flagged: `faable deploy` is `deploy launch`', async t => {
  const { data } = await list('launch')
  t.like(
    data.find(c => c.path === 'deploy launch'),
    { default_of_group: true, effect: 'write' }
  )
})

test('no match: an empty list with --json, a usage hint without', async t => {
  t.deepEqual((await list('zzz-nothing')).data, [])
  const failed = await run('zzz-nothing').catch(e => e)
  t.is(failed.code, 1)
  t.regex(failed.stderr, /No command matches "zzz-nothing"/)
})

test('text: one line per command, with its effect', async t => {
  const out = await run('secrets')
  t.regex(out, /^faable deploy secrets rm\s+destructive\s+Remove a secret/m)
  t.regex(out, /^faable deploy secrets list\s+read\s+/m)
})
