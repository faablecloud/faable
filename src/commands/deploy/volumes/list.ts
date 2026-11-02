import { CommandModule } from 'yargs'
import { json_option, print, print_json } from '../../../lib/listing'
import { log } from '../../../log'
import { resolve_app } from '../schedule/shared'
import { app_option, format_usage } from './shared'

interface ListArgs {
  app?: string
  json?: boolean
}

export const volumes_list: CommandModule<unknown, ListArgs> = {
  command: 'list',
  describe: 'List the volumes of the app, with their measured usage',
  builder: yargs =>
    app_option(json_option(yargs))
      .example('$0 deploy volumes list -a my-blog', 'Volumes of my-blog')
      .showHelpOnFail(false) as any,
  handler: async args => {
    const { api, app, app_id, team } = await resolve_app(args.app)
    const { results } = await api.listVolumes(team, app_id)
    if (args.json) return print_json({ results })
    if (results.length === 0) {
      log.info(
        `💾 ${app.name} has no volumes: only apps created from a blueprint (WordPress) have one today.`
      )
      return
    }
    log.info(`💾 ${results.length} volume(s) of ${app.name}:`)
    for (const v of results) {
      print(`  ${v.name}  ${v.mount_path}  ${format_usage(v)}`)
      const notes = [
        v.id,
        v.used_inodes != null ? `${v.used_inodes} files` : null,
        v.usage_measured_at ? `measured ${v.usage_measured_at}` : null,
        v.backup ? 'nightly backup' : 'no backup',
        v.state === 'retained'
          ? `RETAINED until ${v.retain_until ?? '?'} (read-only: the app is gone or paused)`
          : null
      ].filter(Boolean)
      print(`    ${notes.join(' · ')}`)
    }
  }
}
