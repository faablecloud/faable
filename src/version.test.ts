import test from 'ava'
import { execFile } from 'node:child_process'
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const exec_file = promisify(execFile)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const own = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
  .version as string

// Left to guess, yargs reads the package.json of the directory that holds the
// node_modules it was installed into. Under `npx @faable/faable` that is
// npx's own wrapper, with no version: `faable --version` printed `unknown`
// (and inside a project with yargs hoisted, it would print the project's).
//
// The same layout, built from the repo: a parent package.json without a
// version, the built CLI under node_modules/@faable/faable and its
// dependencies hoisted next to it as symlinks, which --preserve-symlinks
// keeps where they are instead of resolving them back into the repo.
const npx_layout = () => {
  const parent = mkdtempSync(path.join(os.tmpdir(), 'faable-npx-'))
  writeFileSync(path.join(parent, 'package.json'), '{"dependencies":{}}')
  const modules = path.join(parent, 'node_modules')
  const cli = path.join(modules, '@faable', 'faable')
  mkdirSync(cli, { recursive: true })
  for (const entry of ['package.json', 'bin', 'dist']) {
    cpSync(path.join(root, entry), path.join(cli, entry), { recursive: true })
  }
  const repo_modules = path.join(root, 'node_modules')
  for (const name of readdirSync(repo_modules)) {
    if (name === '@faable') continue
    symlinkSync(path.join(repo_modules, name), path.join(modules, name))
  }
  for (const name of readdirSync(path.join(repo_modules, '@faable'))) {
    if (name === 'faable') continue
    symlinkSync(
      path.join(repo_modules, '@faable', name),
      path.join(modules, '@faable', name)
    )
  }
  return { parent, bin: path.join(cli, 'bin', 'faable.js') }
}

// Runs the built binary (`npm run build` goes before `npm test` in CI).
test('--version prints the package version when installed by npx', async t => {
  const { parent, bin } = npx_layout()
  const { stdout } = await exec_file(
    process.execPath,
    ['--preserve-symlinks', bin, '--version'],
    { cwd: parent, env: { ...process.env, HOME: parent, NO_COLOR: '1' } }
  )
  t.is(stdout.trim(), own)
})
