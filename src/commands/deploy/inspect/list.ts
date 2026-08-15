import { CommandModule } from 'yargs'
import { requireApi } from '../../../api/context'
import { log } from '../../../log'
import { phase_badge } from './format'

export const apps_list: CommandModule = {
  command: 'list',
  describe: 'List your apps',
  builder: yargs => yargs.showHelpOnFail(false) as any,
  handler: async () => {
    const ctx = await requireApi()
    const apps = await ctx.api.list()

    if (apps.length === 0) {
      log.info(
        `📭 No apps yet. Create one in the dashboard (https://dashboard.faable.com) and link your repo.`
      )
      return
    }

    log.info(`📦 ${apps.length} app(s):`)
    const width = Math.max(...apps.map(a => a.name.length))
    for (const app of apps) {
      log.info(
        `  ${app.name.padEnd(width)}  ${phase_badge(app.status?.phase)}  ${app.id}  https://${app.url}`
      )
    }
  }
}
