import axios from 'axios'
import { execFile } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, mkdtemp, rename, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import { CommandModule } from 'yargs'
import type { FaableApi, FaableVolumeOperation } from '../../../api/FaableApi'
import { CliError } from '../../../lib/errors'
import { json_option, print_json } from '../../../lib/listing'
import { log } from '../../../log'
import { volume_dest } from './operation'
import {
  app_option,
  format_bytes,
  require_completed,
  resolve_volume,
  state_label,
  volume_option,
  wait_operation
} from './shared'

const exec_file = promisify(execFile)

/** Queues an export (of `sub`, or of everything), waits, and saves it to `file`. */
const export_to_file = async (
  api: FaableApi,
  team: string,
  volume_id: string,
  sub: string | undefined,
  file: string,
  quiet: boolean
): Promise<FaableVolumeOperation> => {
  const op = await api.exportVolume(team, volume_id, sub)
  const done = require_completed(
    await wait_operation(api, team, op, {
      onState: s => {
        if (!quiet && s !== 'completed' && s !== 'failed')
          log.info(state_label[s])
      }
    })
  )
  // The completed operation read by wait_operation carries a fresh URL.
  const url = done.download_url
  if (!url) {
    throw new CliError(
      'not_found',
      `The export ${done.id} finished but has no download link; try again`
    )
  }
  const part = `${file}.part`
  const res = await axios.get(url, { responseType: 'stream', timeout: 0 })
  try {
    await pipeline(res.data, createWriteStream(part))
    await rename(part, file)
  } catch (error) {
    await rm(part, { force: true })
    throw error
  }
  return done
}

interface ExportArgs {
  app?: string
  volume?: string
  path?: string
  output?: string
  json?: boolean
}

export const volumes_export: CommandModule<unknown, ExportArgs> = {
  command: 'export',
  describe:
    'Download the contents of a volume (or of a path of it) as a .tar.gz; the app keeps running',
  builder: yargs =>
    volume_option(app_option(json_option(yargs)))
      .option('path', {
        type: 'string',
        description:
          'Only this file or directory of the volume (its path inside the archive is the same)'
      })
      .option('output', {
        alias: 'o',
        type: 'string',
        description:
          'Where to save it (default <app>-<volume>-<date>.tar.gz in the current directory)'
      })
      .showHelpOnFail(false) as any,
  handler: async args => {
    const sub = volume_dest(args.path)
    const { api, team, app, volume } = await resolve_volume(
      args.app,
      args.volume
    )
    const day = new Date().toISOString().slice(0, 10)
    const file = args.output ?? `${app.name}-${volume.name}-${day}.tar.gz`
    if (!args.json)
      log.info(
        `📦 Exporting ${app.name}/${volume.name}${sub === '.' ? '' : `:${sub}`}`
      )
    const done = await export_to_file(
      api,
      team,
      volume.id,
      sub === '.' ? undefined : sub,
      file,
      !!args.json
    )
    if (args.json) return print_json({ ...done, file })
    log.info(`✅ Saved ${file} (${format_bytes(done.size_bytes)}).`)
  }
}

interface GetArgs {
  path: string
  app?: string
  volume?: string
  output?: string
  json?: boolean
}

export const volumes_get: CommandModule<unknown, GetArgs> = {
  command: 'get <path>',
  describe:
    'Copy a file or directory of a volume here, like cp: it lands as <output>/<its name>. Existing local files are never overwritten',
  builder: yargs =>
    volume_option(app_option(json_option(yargs)))
      .positional('path', {
        type: 'string',
        demandOption: true,
        description: 'A file or directory of the volume, relative to its root'
      })
      .option('output', {
        alias: 'o',
        type: 'string',
        default: '.',
        description: 'The local directory it goes into'
      })
      .example(
        '$0 deploy volumes get wp-content/mu-plugins/my-plugin -a my-blog',
        'A mu-plugin of a WordPress app into ./my-plugin'
      )
      .showHelpOnFail(false) as any,
  handler: async args => {
    const sub = volume_dest(args.path)
    if (sub === '.') {
      throw new CliError(
        'usage',
        'get copies a file or directory; the whole volume is faable deploy volumes export'
      )
    }
    const { api, team, app, volume } = await resolve_volume(
      args.app,
      args.volume
    )
    const out = args.output ?? '.'
    // Like cp, but never over what is here: GNU tar -k fails on an existing
    // file, macOS tar skips it in silence; say it before downloading.
    const local_target = path.join(out, path.posix.basename(sub))
    if (await stat(local_target).catch(() => null)) {
      throw new CliError(
        'usage',
        `${local_target} already exists: nothing is overwritten (move it, or --output another directory)`
      )
    }
    const work = await mkdtemp(path.join(tmpdir(), 'faable-volume-get-'))
    try {
      if (!args.json)
        log.info(`📥 Copying ${app.name}/${volume.name}:${sub} into ${out}`)
      const archive = path.join(work, 'get.tar.gz')
      const done = await export_to_file(
        api,
        team,
        volume.id,
        sub,
        archive,
        !!args.json
      )
      await mkdir(out, { recursive: true })
      // The archive holds the path as it is in the volume: strip its parents
      // so it lands as <out>/<name>. -k: an existing local file is an error,
      // never overwritten.
      const strip = sub.split('/').length - 1
      await exec_file('tar', [
        '-xzkf',
        archive,
        '-C',
        out,
        ...(strip ? [`--strip-components=${strip}`] : [])
      ]).catch((error: { stderr?: string }) => {
        throw new CliError(
          'usage',
          `Could not unpack into ${out}: ${(error.stderr ?? String(error)).trim().split('\n')[0]}`
        )
      })
      const local = local_target
      if (args.json) return print_json({ ...done, local })
      log.info(`✅ ${local} (${format_bytes(done.size_bytes)} compressed).`)
    } finally {
      await rm(work, { recursive: true, force: true })
    }
  }
}
