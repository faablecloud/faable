import axios from 'axios'
import { execFile } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { cp, mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { CommandModule } from 'yargs'
import { CliError } from '../../../lib/errors'
import { confirm } from '../../../lib/interactive'
import { json_option, print_json } from '../../../lib/listing'
import { log } from '../../../log'
import { is_archive, volume_dest } from './operation'
import {
  app_option,
  format_bytes,
  require_completed,
  resolve_volume,
  state_label,
  volume_option,
  wait_operation,
  wait_option
} from './shared'

const exec_file = promisify(execFile)

/** A .tar.gz of `dir`, its contents under `dest` inside the archive. */
const pack_directory = async (dir: string, dest: string) => {
  const work = await mkdtemp(path.join(tmpdir(), 'faable-volume-'))
  const staging = path.join(work, 'root')
  await cp(dir, path.join(staging, dest), { recursive: true })
  const archive = path.join(work, 'import.tar.gz')
  // COPYFILE_DISABLE: macOS tar would add an AppleDouble `._name` per file
  // with extended attributes.
  await exec_file(
    'tar',
    ['--exclude', '.DS_Store', '-czf', archive, '-C', staging, '.'],
    { env: { ...process.env, COPYFILE_DISABLE: '1' } }
  )
  return { archive, cleanup: () => rm(work, { recursive: true, force: true }) }
}

interface ImportArgs {
  source: string
  to?: string
  app?: string
  volume?: string
  yes?: boolean
  wait?: boolean
  json?: boolean
}

export const volumes_import: CommandModule<unknown, ImportArgs> = {
  command: 'import <source>',
  describe:
    'Copy a directory (or a .tar.gz) into a volume: same names are replaced, the rest is kept. The app stops while it copies; a backup goes first',
  builder: yargs =>
    wait_option(volume_option(app_option(json_option(yargs))))
      .positional('source', {
        type: 'string',
        demandOption: true,
        description: 'A directory, or a .tar.gz whose root is the volume root'
      })
      .option('to', {
        type: 'string',
        description:
          'Where the directory goes inside the volume (default its root)'
      })
      .option('yes', {
        alias: 'y',
        type: 'boolean',
        default: false,
        description: 'Skip the confirmation prompt'
      })
      .example(
        '$0 deploy volumes import ./my-plugin --to wp-content/mu-plugins/my-plugin -a my-blog',
        'A mu-plugin into a WordPress app'
      )
      .example(
        '$0 deploy volumes import site.tar.gz -a my-blog',
        'An archive (e.g. from volumes export), over the whole volume'
      )
      .showHelpOnFail(false) as any,
  handler: async args => {
    const dest = volume_dest(args.to)
    const info = await stat(args.source).catch(() => null)
    if (!info) throw new CliError('not_found', `No such file or directory: ${args.source}`)
    const archive_given = info.isFile() && is_archive(args.source)
    if (!info.isDirectory() && !archive_given) {
      throw new CliError('usage', `${args.source} is neither a directory nor a .tar.gz`)
    }
    if (archive_given && dest !== '.') {
      throw new CliError(
        'usage',
        '--to places a directory; an archive is unpacked at the volume root as it is'
      )
    }

    const { api, team, app, volume } = await resolve_volume(args.app, args.volume)
    const where = `${app.name}/${volume.name}${dest === '.' ? '' : `:${dest}`}`
    const go = await confirm({
      message: `Copy ${args.source} into ${where}? Files with the same name are replaced; ${app.name} stops while it copies.`,
      yes: args.yes
    })
    if (!go) {
      log.info('Cancelled.')
      return
    }

    const packed = archive_given
      ? { archive: args.source, cleanup: async () => {} }
      : await pack_directory(args.source, dest)
    try {
      const size = (await stat(packed.archive)).size
      const op = await api.createVolumeOperation(team, volume.id, 'import')
      if (!op.upload_url) {
        throw new CliError('not_found', `The import ${op.id} came without an upload link`)
      }
      if (!args.json) log.info(`📤 Uploading ${format_bytes(size)} (${op.id})`)
      await axios.put(op.upload_url, createReadStream(packed.archive), {
        headers: { 'content-length': String(size) },
        maxBodyLength: Infinity,
        timeout: 0
      })
      const applied = await api.applyVolumeImport(team, op.id)
      if (!args.wait) {
        if (args.json) return print_json(applied)
        log.info(`📥 Import ${op.id} queued, after a backup of the current contents.`)
        return
      }
      if (!args.json)
        log.info(`📥 Copying into ${where}; the current contents are backed up first (${applied.after_id ?? '—'})`)
      const done = await wait_operation(api, team, applied, {
        onState: s => {
          if (!args.json && s !== 'completed' && s !== 'failed') log.info(state_label[s])
        }
      })
      if (args.json) print_json(done)
      require_completed(done)
      if (!args.json)
        log.info(`✅ Copied into ${where}. To undo it, restore the backup taken just before: ${done.after_id ?? '—'}`)
    } finally {
      await packed.cleanup()
    }
  }
}
