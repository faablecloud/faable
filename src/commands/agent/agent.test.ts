import test from 'ava'
import { execFile, execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { install_dir, stamped } from '.'

// `faable agent` (arch/deploy/cli-code-mode-plan.md, F2): the skill bundled
// in plugin/ — the one the Claude Code plugin serves — installed where an
// agent finds it, and never out of step with the commands it names.
const exec_file = promisify(execFile)
const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const root = path.resolve(src, '..')
const SKILL = path.join(root, 'plugin', 'skills', 'faable', 'SKILL.md')

const run = async (
  args: string[],
  home: string,
  env: Record<string, string> = {}
) => {
  try {
    const { stdout, stderr } = await exec_file(
      process.execPath,
      ['--import', 'tsx', path.join(src, 'index.ts'), ...args],
      { cwd: root, env: { ...process.env, HOME: home, NO_COLOR: '1', ...env } }
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

const new_home = () => mkdtempSync(path.join(os.tmpdir(), 'faable-agent-'))

test('install writes the bundled skill, stamped, into ~/.claude/skills/faable', async t => {
  const home = new_home()
  const first = await run(['agent', 'install', '--json'], home)
  t.is(first.code, 0, first.stderr)
  const file = path.join(home, '.claude', 'skills', 'faable', 'SKILL.md')
  t.is(JSON.parse(first.stdout).result, 'installed')
  const written = readFileSync(file, 'utf8')
  // Still a skill: the frontmatter first, then the stamp, then the body.
  t.true(written.startsWith('---\nname: faable\n'))
  t.regex(
    written,
    /\n---\n<!-- installed by `faable agent install` from @faable\/faable /
  )
  t.is(written, stamped(readFileSync(SKILL, 'utf8')))

  const again = await run(['agent', 'install', '--json'], home)
  t.is(JSON.parse(again.stdout).result, 'noop')
})

test('install leaves alone a SKILL.md it did not write, unless --force', async t => {
  const home = new_home()
  const dir = path.join(home, 'mine')
  mkdirSync(dir)
  writeFileSync(path.join(dir, 'SKILL.md'), 'my own skill\n')

  const refused = await run(['agent', 'install', '--dir', dir, '--json'], home)
  t.is(refused.code, 1)
  t.is(JSON.parse(refused.stderr.trim().split('\n').pop()!).error.code, 'usage')
  t.is(readFileSync(path.join(dir, 'SKILL.md'), 'utf8'), 'my own skill\n')

  const forced = await run(
    ['agent', 'install', '--dir', dir, '--force', '--json'],
    home
  )
  t.is(forced.code, 0, forced.stderr)
  t.is(JSON.parse(forced.stdout).result, 'updated')
})

test('install is local: read-only mode lets it through', async t => {
  const home = new_home()
  const r = await run(['agent', 'install', '--agents', '--json'], home, {
    FAABLE_READONLY: '1'
  })
  t.is(r.code, 0, r.stderr)
  t.true(existsSync(path.join(home, '.agents', 'skills', 'faable', 'SKILL.md')))
})

test('install_dir: user and project scope, .claude or .agents, --dir wins', t => {
  const cwd = '/work/app'
  const home = '/home/ana'
  t.is(install_dir({}, cwd, home), '/home/ana/.claude/skills/faable')
  t.is(
    install_dir({ scope: 'project' }, cwd, home),
    '/work/app/.claude/skills/faable'
  )
  t.is(
    install_dir({ agents: true }, cwd, home),
    '/home/ana/.agents/skills/faable'
  )
  t.is(
    install_dir({ scope: 'project', agents: true }, cwd, home),
    '/work/app/.agents/skills/faable'
  )
  t.is(install_dir({ dir: 'x', scope: 'project' }, cwd, home), '/work/app/x')
})

test('agent skill prints the bundled skill', async t => {
  const r = await run(['agent', 'skill'], new_home())
  t.is(r.code, 0, r.stderr)
  t.is(r.stdout, readFileSync(SKILL, 'utf8').trimEnd() + '\n')
})

// ── The skill names only commands and flags that exist ───────────────────

const commands: {
  path: string
  options?: { name: string; aliases?: string[] }[]
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
const { global_options } = JSON.parse(
  execFileSync(
    process.execPath,
    [
      '--import',
      'tsx',
      path.join(src, 'index.ts'),
      'commands',
      'whoami',
      '--json'
    ],
    { env: { ...process.env, NO_COLOR: '1' } }
  ).toString()
)
const roots = new Set(commands.map(c => c.path.split(' ')[0]))

// Every `faable …` (or a recipe's bare `deploy …` / `auth …`) in a code span
// or a code block, cut at a pipe.
const invocations = (md: string) => {
  const spans = [
    ...md.matchAll(/```[a-z]*\n([\s\S]*?)```/g).flatMap(m => m[1].split('\n')),
    ...md
      .replace(/```[\s\S]*?```/g, '')
      .matchAll(/`([^`\n]+)`/g)
      .map(m => m[1])
  ]
  return (
    spans
      .map(s => s.split('|')[0].split('#')[0].trim())
      .map(s => s.replace(/^(FAABLE_[A-Z_]+=\S+\s+)+/, ''))
      .map(s => s.split(/\s+/).filter(Boolean))
      .map(w => (w[0] === 'faable' ? w.slice(1) : w))
      // Placeholders (`<app>`, `[--app <app>]`) are not words of the command.
      .map(w => w.filter(x => !/^[<[]|[>\]]$/.test(x)))
      .filter(w => w.length && roots.has(w[0]))
  )
}

test('every command and flag the skill names exists', t => {
  const md = readFileSync(SKILL, 'utf8')
  const found = invocations(md)
  t.true(found.length > 20, 'the skill parser found its commands')
  const global = new Set(
    global_options.flatMap((o: any) => [o.name, ...(o.aliases ?? [])])
  )
  const wrong: string[] = []
  for (const words of found) {
    let cmd
    for (let n = words.length; n > 0 && !cmd; n--)
      cmd = commands.find(c => c.path === words.slice(0, n).join(' '))
    // A bare group name in prose (`deploy`, `auth`) names no command.
    if (!cmd) {
      if (words.length > 1) wrong.push(`${words.join(' ')}: no such command`)
      continue
    }
    const known = new Set([
      'json',
      'help',
      ...global,
      ...(cmd.options ?? []).flatMap(o => [o.name, ...(o.aliases ?? [])])
    ])
    for (const w of words) {
      // A whole flag word; `-last_login` is the value of --sort.
      const flag = /^--?(?:no-)?([a-z][a-z-]*)$/.exec(w)?.[1]
      if (flag && !known.has(flag)) wrong.push(`${words.join(' ')}: ${w}`)
    }
  }
  t.deepEqual(wrong, [])
})
