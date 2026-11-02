import { execFile } from 'node:child_process'
import { cp, mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const exec_file = promisify(execFile)

/**
 * A .tar.gz with the sources under `dest`: a directory's contents go into
 * `dest`, a file goes to `dest/<its name>`.
 */
export const pack = async (sources: string[], dest: string) => {
  const work = await mkdtemp(path.join(tmpdir(), 'faable-volume-'))
  const staging = path.join(work, 'root')
  const into = path.join(staging, dest)
  for (const src of sources) {
    const isDir = (await stat(src)).isDirectory()
    await cp(src, isDir ? into : path.join(into, path.basename(src)), {
      recursive: true
    })
  }
  const archive = path.join(work, 'upload.tar.gz')
  // COPYFILE_DISABLE: macOS tar would add an AppleDouble `._name` per file
  // with extended attributes.
  await exec_file(
    'tar',
    ['--exclude', '.DS_Store', '-czf', archive, '-C', staging, '.'],
    { env: { ...process.env, COPYFILE_DISABLE: '1' } }
  )
  return { archive, cleanup: () => rm(work, { recursive: true, force: true }) }
}
