import { CommandModule } from 'yargs'
import { json_option, print_json } from '../../../lib/listing'
import { log } from '../../../log'
import { app_option, resolve_app } from './shared'

interface RmArgs {
  id: string
  app?: string
  json?: boolean
}

export const schedule_rm: CommandModule<unknown, RmArgs> = {
  command: 'rm <id>',
  describe: 'Delete a schedule (runs already queued keep going)',
  builder: yargs =>
    app_option(json_option(yargs))
      .positional('id', {
        type: 'string',
        description: 'The schedule id (see `faable deploy schedule list`)'
      })
      .showHelpOnFail(false) as any,
  handler: async args => {
    const { api, team } = await resolve_app(args.app)
    const s = await api.deleteTaskSchedule(team, args.id)
    if (args.json) return print_json(s)
    log.info(`🗑  Deleted ${s.id}${s.name ? ` (${s.name})` : ''}.`)
  }
}
