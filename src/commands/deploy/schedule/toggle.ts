import { CommandModule } from 'yargs'
import { json_option, print, print_json } from '../../../lib/listing'
import { log } from '../../../log'
import { format_schedule } from './format'
import { app_option, resolve_app } from './shared'

interface ToggleArgs {
  id: string
  app?: string
  json?: boolean
}

const toggle = (enabled: boolean): CommandModule<unknown, ToggleArgs> => ({
  command: `${enabled ? 'enable' : 'disable'} <id>`,
  describe: enabled
    ? 'Turn a schedule back on (it runs from its next slot)'
    : 'Stop a schedule without deleting it',
  builder: yargs =>
    app_option(json_option(yargs))
      .positional('id', {
        type: 'string',
        description: 'The schedule id (see `faable deploy schedule list`)'
      })
      .showHelpOnFail(false) as any,
  handler: async args => {
    const { api, team } = await resolve_app(args.app)
    const s = await api.updateTaskSchedule(team, args.id, { enabled })
    if (args.json) return print_json(s)
    log.info(enabled ? '⏰ Schedule on.' : '⏸  Schedule off.')
    for (const line of format_schedule(s)) print(line)
  }
})

export const schedule_enable = toggle(true)
export const schedule_disable = toggle(false)
