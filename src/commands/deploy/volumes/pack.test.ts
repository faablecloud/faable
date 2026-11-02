import test from 'ava'
import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { pack } from './pack'

const exec_file = promisify(execFile)

test('put packs a directory’s contents into --to and a file by its name, nothing else', async t => {
  const src = mkdtempSync(path.join(tmpdir(), 'pack-src-'))
  mkdirSync(path.join(src, 'plugin/sub'), { recursive: true })
  writeFileSync(path.join(src, 'plugin/main.php'), '<?php')
  writeFileSync(path.join(src, 'plugin/sub/a.css'), 'a')
  writeFileSync(path.join(src, 'plugin/.DS_Store'), 'junk')
  writeFileSync(path.join(src, 'extra.txt'), 'x')
  const packed = await pack(
    [path.join(src, 'plugin'), path.join(src, 'extra.txt')],
    'wp-content/mu-plugins/p'
  )
  try {
    const { stdout } = await exec_file('tar', ['-tzf', packed.archive])
    const files = stdout
      .split('\n')
      .filter(l => l && !l.endsWith('/'))
      .map(l => l.replace(/^\.\//, ''))
      .sort()
    t.deepEqual(files, [
      'wp-content/mu-plugins/p/extra.txt',
      'wp-content/mu-plugins/p/main.php',
      'wp-content/mu-plugins/p/sub/a.css'
    ])
  } finally {
    await packed.cleanup()
  }
})
