import test from 'ava'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import parse from 'yargs-parser'
import { TOOLS } from '../mcp/tools'
import { EFFECTS, effect_of } from './effects'

// The catalog as the CLI prints it — the command tree is only loaded by the
// real entrypoint (some of its modules are ESM-only).
const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const catalog: {
  path: string
  effect?: string
  positionals?: { name: string; array?: boolean }[]
}[] = JSON.parse(
  execFileSync(
    process.execPath,
    [
      '--import',
      'tsx',
      path.join(src, 'index.ts'),
      'commands',
      '--hidden',
      '--json'
    ],
    { env: { ...process.env, NO_COLOR: '1' }, maxBuffer: 16 << 20 }
  ).toString()
).data

test('every command, hidden ones too, says what it does to Faable', t => {
  const missing = catalog.filter(c => !c.effect).map(c => c.path)
  t.deepEqual(missing, [], 'add them to src/lib/effects.ts')
})

test('no effect is declared for a command that does not exist', t => {
  const paths = new Set(catalog.map(c => c.path))
  t.deepEqual(
    Object.keys(EFFECTS).filter(p => !paths.has(p)),
    []
  )
})

// The command a tool calls — the longest catalog path its words start with,
// as yargs routes it: `deploy install restore` is `install` with `restore`
// as its first positional.
const command_of = (words: string[]) => {
  for (let n = words.length; n > 0; n--) {
    const cmd = catalog.find(c => c.path === words.slice(0, n).join(' '))
    if (cmd) return { cmd, rest: words.slice(n) }
  }
  throw new Error(`no command for ${words.join(' ')}`)
}

// The argv a tool's example call would give its command: flags parsed, and
// the bare words bound to the command's positionals in order, as yargs does.
const argv_of = (tool: (typeof TOOLS)[number]) => {
  const { cmd, rest } = command_of(tool.command)
  const parsed = parse(tool.flags(tool.example))
  const words = [...rest, ...parsed._.map(String)]
  ;(cmd.positionals ?? []).forEach((p, i) => {
    parsed[p.name] = p.array ? words.slice(i) : words[i]
  })
  return parsed
}

// The MCP shows the client the same thing the CLI enforces: a tool is
// read-only exactly when its call is a read, destructive exactly when it is
// destructive, and nothing behind --writes is a read.
for (const tool of TOOLS) {
  test(`${tool.name}: its annotations agree with the effect of its call`, t => {
    const effect = effect_of(command_of(tool.command).cmd.path, argv_of(tool))
    t.truthy(effect, 'command without an effect')
    t.is(tool.annotations.readOnlyHint, effect === 'read', `effect ${effect}`)
    t.is(
      tool.annotations.destructiveHint,
      effect === 'destructive',
      `effect ${effect}`
    )
    if (tool.write) t.not(effect, 'read')
  })
}

test('an effect that depends on the arguments: install lists without an app', t => {
  t.is(effect_of('deploy install', {}), 'read')
  t.is(effect_of('deploy install', { app: 'restore' }), 'read')
  t.is(
    effect_of('deploy install', { app: 'restore', installation: 'x' }),
    'write'
  )
  t.is(effect_of('deploy install', { app: 'wordpress' }), 'write')
  t.is(effect_of('auth users roles', { user: 'u' }), 'read')
  t.is(effect_of('auth users roles', { add: ['admin'] }), 'write')
  t.is(effect_of('auth users roles', { add: [] }), 'read')
})
