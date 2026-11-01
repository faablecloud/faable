import { CommandModule } from 'yargs'
import { CliError } from '../../../lib/errors'
import { json_option, print, print_json } from '../../../lib/listing'
import { log } from '../../../log'
import { format_schedule } from './format'
import { app_option, resolve_app } from './shared'

interface AddArgs {
  app?: string
  cron?: string
  name?: string
  timeout?: number
  json?: boolean
  // Everything after `--`: the command, as is.
  '--'?: (string | number)[]
}

export const schedule_add: CommandModule<unknown, AddArgs> = {
  command: 'add',
  describe: 'Run a command of the app on a cron schedule (UTC)',
  builder: yargs =>
    app_option(json_option(yargs))
      .parserConfiguration({ 'populate--': true })
      // No `-c`: it is the global --config.
      .option('cron', {
        type: 'string',
        demandOption: true,
        description:
          'Five-field cron expression in UTC (minute hour day month weekday), at most every 5 minutes'
      })
      .option('name', {
        alias: 'n',
        type: 'string',
        description: 'A name to recognise it by'
      })
      .option('timeout', {
        type: 'number',
        description:
          'Seconds before each run is stopped (default 900, max 3600)'
      })
      .example(
        '$0 deploy schedule add --cron "*/15 * * * *" -- node scripts/followups.js',
        'Every 15 minutes'
      )
      .example(
        '$0 deploy schedule add --cron "0 7 * * 1-5" -n digest -- npm run digest',
        'Weekdays at 07:00 UTC'
      )
      .showHelpOnFail(false) as any,
  handler: async args => {
    const argv = (args['--'] ?? []).map(String)
    if (argv.length === 0) {
      throw new CliError(
        'usage',
        'Say what to run after --, e.g. faable deploy schedule add --cron "*/15 * * * *" -- node job.js'
      )
    }
    const { api, app_id, app, team } = await resolve_app(args.app)
    const s = await api.createTaskSchedule(team, {
      app_id,
      cron: args.cron!,
      argv,
      ...(args.name ? { name: args.name } : {}),
      ...(args.timeout ? { timeout_s: args.timeout } : {})
    })
    if (args.json) return print_json(s)
    log.info(
      `⏰ Scheduled on ${app.name}. Each run is a task: faable deploy run shows the same output.`
    )
    for (const line of format_schedule(s)) print(line)
  }
}
