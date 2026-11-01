import { CommandModule } from 'yargs'
import { json_option, print, print_json } from '../../../lib/listing'
import { log } from '../../../log'
import { format_schedule } from './format'
import { app_option, resolve_app } from './shared'

interface ListArgs {
  app?: string
  json?: boolean
}

export const schedule_list: CommandModule<unknown, ListArgs> = {
  command: 'list',
  describe: 'Show the task schedules of the app',
  builder: yargs => app_option(json_option(yargs)).showHelpOnFail(false) as any,
  handler: async args => {
    const { api, app_id, app, team } = await resolve_app(args.app)
    const { results } = await api.listTaskSchedules(team, app_id)
    if (args.json) return print_json(results)
    if (results.length === 0) {
      log.info(
        `No schedules on ${app.name}. Add one with: faable deploy schedule add --cron "*/15 * * * *" -- <command>`
      )
      return
    }
    log.info(`⏰ Schedules of ${app.name} (${app_id})`)
    log.info('')
    for (const s of results) for (const line of format_schedule(s)) print(line)
  }
}
