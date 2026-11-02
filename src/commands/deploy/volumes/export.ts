import axios from 'axios'
import { createWriteStream } from 'node:fs'
import { rename, rm } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { CommandModule } from 'yargs'
import { CliError } from '../../../lib/errors'
import { json_option, print_json } from '../../../lib/listing'
import { log } from '../../../log'
import {
  app_option,
  format_bytes,
  require_completed,
  resolve_volume,
  state_label,
  volume_option,
  wait_operation
} from './shared'

interface ExportArgs {
  app?: string
  volume?: string
  output?: string
  json?: boolean
}

export const volumes_export: CommandModule<unknown, ExportArgs> = {
  command: 'export',
  describe:
    'Download the contents of a volume as a .tar.gz (the app keeps running)',
  builder: yargs =>
    volume_option(app_option(json_option(yargs)))
      .option('output', {
        alias: 'o',
        type: 'string',
        description:
          'Where to save it (default <app>-<volume>-<date>.tar.gz in the current directory)'
      })
      .showHelpOnFail(false) as any,
  handler: async args => {
    const { api, team, app, volume } = await resolve_volume(
      args.app,
      args.volume
    )
    const op = await api.createVolumeOperation(team, volume.id, 'export')
    if (!args.json)
      log.info(`📦 Exporting ${app.name}/${volume.name} (${op.id})`)
    const done = require_completed(
      await wait_operation(api, team, op, {
        onState: s => {
          if (!args.json && s !== 'completed' && s !== 'failed')
            log.info(state_label[s])
        }
      })
    )
    // The completed operation read by wait_operation carries a fresh URL.
    const url = done.download_url
    if (!url) {
      throw new CliError(
        'not_found',
        `The export ${done.id} finished but has no download link; try faable deploy volumes export again`
      )
    }
    const day = new Date().toISOString().slice(0, 10)
    const file = args.output ?? `${app.name}-${volume.name}-${day}.tar.gz`
    const part = `${file}.part`
    const res = await axios.get(url, { responseType: 'stream', timeout: 0 })
    try {
      await pipeline(res.data, createWriteStream(part))
      await rename(part, file)
    } catch (error) {
      await rm(part, { force: true })
      throw error
    }
    if (args.json) return print_json({ ...done, file })
    log.info(`✅ Saved ${file} (${format_bytes(done.size_bytes)}).`)
  }
}
