import axios from 'axios'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Argv, CommandModule } from 'yargs'
import { CliError } from '../../../lib/errors'
import { confirm } from '../../../lib/interactive'
import { json_option, print_json } from '../../../lib/listing'
import { log } from '../../../log'
import { is_archive, volume_dest } from './operation'
import { pack } from './pack'
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

interface UploadArgs {
  sources: string[]
  to?: string
  app?: string
  volume?: string
  yes?: boolean
  wait?: boolean
  json?: boolean
}

const upload_options = <T>(yargs: Argv<T>) =>
  wait_option(volume_option(app_option(json_option(yargs))))
    .option('to', {
      type: 'string',
      description:
        'The directory inside the volume it goes to (default its root): a directory’s contents go into it, a file keeps its name'
    })
    .option('yes', {
      alias: 'y',
      type: 'boolean',
      default: false,
      description: 'Skip the confirmation prompt'
    })

/**
 * import and put: pack, PUT to the signed URL, apply, wait. They differ in
 * what the platform does with the archive — an import stops the app and backs
 * the volume up first; a put (up to 100 MB) renames each file into the live
 * volume — and so in what they say.
 */
const upload_handler = (kind: 'import' | 'put') => async (args: UploadArgs) => {
  const dest = volume_dest(args.to)
  const infos = await Promise.all(
    args.sources.map(async s => {
      const info = await stat(s).catch(() => null)
      if (!info)
        throw new CliError('not_found', `No such file or directory: ${s}`)
      return info
    })
  )
  const archive_given =
    args.sources.length === 1 &&
    infos[0].isFile() &&
    is_archive(args.sources[0])
  if (archive_given && dest !== '.') {
    throw new CliError(
      'usage',
      '--to places files and directories; an archive is unpacked at the volume root as it is'
    )
  }
  if (kind === 'import' && !archive_given && !infos[0].isDirectory()) {
    throw new CliError(
      'usage',
      `${args.sources[0]} is neither a directory nor a .tar.gz (a few files: faable deploy volumes put)`
    )
  }

  const { api, team, app, volume } = await resolve_volume(args.app, args.volume)
  const where = `${app.name}/${volume.name}${dest === '.' ? '' : `:${dest}`}`
  const what = args.sources.join(', ')
  const go = await confirm({
    message:
      kind === 'import'
        ? `Copy ${what} into ${where}? Files with the same name are replaced; ${app.name} stops while it copies.`
        : `Copy ${what} into ${where}? Files with the same name are replaced (no backup first); ${app.name} keeps serving.`,
    yes: args.yes
  })
  if (!go) {
    log.info('Cancelled.')
    return
  }

  const packed = archive_given
    ? { archive: args.sources[0], cleanup: async () => {} }
    : await pack(args.sources, dest)
  try {
    const size = (await stat(packed.archive)).size
    const op = await api.createVolumeOperation(team, volume.id, kind)
    if (!op.upload_url) {
      throw new CliError(
        'not_found',
        `The ${kind} ${op.id} came without an upload link`
      )
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
      log.info(`📥 ${kind} ${op.id} queued.`)
      return
    }
    if (!args.json)
      log.info(
        kind === 'import'
          ? `📥 Copying into ${where}; the current contents are backed up first (${applied.after_id ?? '—'})`
          : `📥 Copying into ${where}`
      )
    const done = await wait_operation(api, team, applied, {
      onState: s => {
        if (!args.json && s !== 'completed' && s !== 'failed')
          log.info(state_label[s])
      }
    })
    if (args.json) print_json(done)
    require_completed(done)
    if (!args.json)
      log.info(
        kind === 'import'
          ? `✅ Copied into ${where}. To undo it, restore the backup taken just before: ${done.after_id ?? '—'}`
          : `✅ Copied into ${where}.`
      )
  } finally {
    await packed.cleanup()
  }
}

export const volumes_import: CommandModule<unknown, UploadArgs> = {
  command: 'import <sources..>',
  describe:
    'Copy a directory (or a .tar.gz) into a volume: same names are replaced, the rest is kept. The app stops while it copies; a backup goes first',
  builder: yargs =>
    upload_options(yargs)
      .positional('sources', {
        type: 'string',
        array: true,
        demandOption: true,
        description: 'A directory, or a .tar.gz whose root is the volume root'
      })
      .check(a => {
        if ((a.sources as string[]).length > 1)
          throw new Error(
            'import takes one directory or archive; a few files: volumes put'
          )
        return true
      })
      .example(
        '$0 deploy volumes import ./wp-content --to wp-content -a my-blog',
        'A whole wp-content into a WordPress app'
      )
      .example(
        '$0 deploy volumes import site.tar.gz -a my-blog',
        'An archive (e.g. from volumes export), over the whole volume'
      )
      .showHelpOnFail(false) as any,
  handler: upload_handler('import')
}

export const volumes_put: CommandModule<unknown, UploadArgs> = {
  command: 'put <sources..>',
  describe:
    'Copy a few files into a volume while the app keeps serving (up to 100 MB): each one replaces its old version at once; nothing else changes',
  builder: yargs =>
    upload_options(yargs)
      .positional('sources', {
        type: 'string',
        array: true,
        demandOption: true,
        description:
          'Files and directories (a directory’s contents go into --to)'
      })
      .example(
        '$0 deploy volumes put single.php style.css --to wp-content/mu-plugins/my-plugin -a my-blog',
        'Two files of a mu-plugin into a live WordPress'
      )
      .example(
        '$0 deploy volumes put ./my-plugin --to wp-content/mu-plugins/my-plugin -a my-blog',
        'A plugin directory'
      )
      .showHelpOnFail(false) as any,
  handler: upload_handler('put')
}
