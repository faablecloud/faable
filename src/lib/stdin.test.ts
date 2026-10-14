import test from 'ava'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// `faable auth webhooks create --json | … | faable deploy secrets set -f -`
// failed with EAGAIN: the CLI touches `process.stdin` early (the TTY check),
// which makes fd 0 non-blocking, and `readFileSync(0)` on a pipe that has not
// been written yet throws instead of waiting. The writer here is late on
// purpose, and the reader touches stdin first, like the CLI does.
const here = path.dirname(fileURLToPath(import.meta.url))

const readWithLateWriter = (script: string) =>
  new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', '-e', script], {
      cwd: path.resolve(here, '..', '..'),
      stdio: ['pipe', 'pipe', 'inherit']
    })
    let out = ''
    child.stdout.on('data', d => (out += d))
    child.on('error', reject)
    child.on('close', () => resolve(out.trim()))
    setTimeout(() => child.stdin.end('A=1\n'), 500)
  })

test('read_stdin waits for a late writer on a non-blocking pipe', async t => {
  const out = await readWithLateWriter(
    "process.stdin.isTTY; import('./src/lib/stdin.ts').then(m => m.read_stdin()).then(s => console.log(JSON.stringify(s)))"
  )
  t.is(out, JSON.stringify('A=1\n'))
})

test('the synchronous read it replaces fails in the same setup (the bug)', async t => {
  const out = await readWithLateWriter(
    "process.stdin.isTTY; try { console.log(require('fs').readFileSync(0, 'utf8')) } catch (e) { console.log(e.code) }"
  )
  t.is(out, 'EAGAIN')
})
