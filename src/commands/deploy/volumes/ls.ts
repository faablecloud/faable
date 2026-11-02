import { CommandModule } from 'yargs'
import { json_option, print, print_json } from '../../../lib/listing'
import { log } from '../../../log'
import { format_entry, volume_dest } from './operation'
import {
  app_option,
  require_completed,
  resolve_volume,
  volume_option,
  wait_operation
} from './shared'

interface LsArgs {
  path?: string
  app?: string
  volume?: string
  json?: boolean
}

export const volumes_ls: CommandModule<unknown, LsArgs> = {
  command: 'ls [path]',
  describe:
    'List a directory of a volume (default its root), with the app serving',
  builder: yargs =>
    volume_option(app_option(json_option(yargs)))
      .positional('path', {
        type: 'string',
        description: 'A directory of the volume, relative to its root'
      })
      .example(
        '$0 deploy volumes ls wp-content/mu-plugins -a my-blog',
        'The mu-plugins of a WordPress app'
      )
      .showHelpOnFail(false) as any,
  handler: async args => {
    const sub = volume_dest(args.path)
    const { api, team, app, volume } = await resolve_volume(
      args.app,
      args.volume
    )
    const op = await api.listVolumeFiles(
      team,
      volume.id,
      sub === '.' ? undefined : sub
    )
    const done = require_completed(await wait_operation(api, team, op))
    const entries = done.entries ?? []
    if (args.json) return print_json({ path: sub, entries })
    const where = `${app.name}/${volume.name}:${sub === '.' ? '/' : sub}`
    if (entries.length === 0) {
      log.info(`📂 ${where} is empty.`)
      return
    }
    log.info(`📂 ${where}`)
    for (const e of entries) print(`  ${format_entry(e)}`)
    if (entries.length >= 1000)
      log.info('Only the first 1000 entries, by name.')
  }
}
