import { CommandModule } from 'yargs'
import { requireApi } from '../../../api/context'
import { CliError } from '../../../lib/errors'
import { json_option, print_json } from '../../../lib/listing'
import { log } from '../../../log'
import { resolve_app_id } from '../resolve_app_id'
import { waitForTask } from './task_wait'

interface RunArgs {
  app?: string
  wait?: boolean
  timeout?: number
  json?: boolean
  // Everything after `--`: the command, as is.
  '--'?: (string | number)[]
}

export const run: CommandModule<unknown, RunArgs> = {
  command: 'run',
  // Hidden until the WordPress blueprint is published (api `/task` is
  // internal: blueprint apps and staff only). Then: the describe below.
  // 'Run a one-off command with the image, variables and volumes of the live deployment'
  describe: false,
  builder: yargs =>
    json_option(yargs)
      .parserConfiguration({ 'populate--': true })
      .option('app', {
        alias: 'a',
        type: 'string',
        description: 'App id, name or slug (defaults to the linked app)'
      })
      .option('wait', {
        type: 'boolean',
        default: true,
        description:
          'Wait for the result and print its output (--no-wait to only queue it)'
      })
      .option('timeout', {
        type: 'number',
        description:
          'Seconds before the task is stopped (default 900, max 3600)'
      })
      .example(
        '$0 deploy run -a my-blog -- wp plugin list',
        'wp-cli on a WordPress app'
      )
      .example(
        '$0 deploy run -- node scripts/migrate.js',
        'A script of your own app'
      )
      .showHelpOnFail(false) as any,
  handler: async args => {
    const argv = (args['--'] ?? []).map(String)
    if (argv.length === 0) {
      throw new CliError(
        'usage',
        'Say what to run after --, e.g. faable deploy run -- wp plugin list'
      )
    }
    const ctx = await requireApi()
    const app_id = await resolve_app_id(args.app, ctx.appId, ctx.api)
    const app = await ctx.api.getApp(app_id)
    const queued = await ctx.api.createTask(app.team, {
      app_id,
      argv,
      ...(args.timeout ? { timeout_s: args.timeout } : {})
    })
    if (!args.wait) {
      if (args.json) return print_json(queued)
      log.info(`🧰 Queued ${queued.id} on ${app.name}.`)
      return
    }
    if (!args.json)
      log.info(`🧰 ${argv.join(' ')} on ${app.name} (${queued.id})`)
    const done = await waitForTask(() => ctx.api.getTask(queued.id, app.team), {
      onStatus: s => {
        if (!args.json && s === 'running') log.info('… running')
      }
    })
    if (args.json) {
      print_json(done)
    } else {
      if (done.output_tail)
        process.stdout.write(done.output_tail.replace(/\n?$/, '\n'))
      const how =
        done.status === 'succeeded'
          ? '✅ Done'
          : done.status === 'timed_out'
            ? '⏱️  Timed out'
            : `❌ ${done.reason ?? 'Failed'}`
      log.info(
        `${how}${done.exit_code != null ? ` (exit ${done.exit_code})` : ''}`
      )
    }
    // The command's own exit code, so scripts can branch on it.
    if (done.status !== 'succeeded') process.exitCode = done.exit_code || 1
  }
}
