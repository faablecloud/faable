import { CommandModule } from 'yargs'
import { requireApi } from '../../../api/context'
import { CliError } from '../../../lib/errors'
import { as_list, json_option, print_json } from '../../../lib/listing'
import { log } from '../../../log'
import { follow_remote_build } from '../remote/follow'
import { resolve_app_id } from '../resolve_app_id'
import { format_log_lines, log_entries, tail_lines } from './format'

interface LogsArgs {
  app?: string
  build?: boolean
  deployment?: string
  follow?: boolean
  tail?: number
  json?: boolean
}

// Phases where the build is still producing output; anything else is a frozen
// record and following would just wait on nothing.
const FOLLOWABLE_PHASES = new Set(['UNKNOWN', 'QUEUED', 'BUILDING'])

export const logs: CommandModule<unknown, LogsArgs> = {
  command: 'logs',
  describe: 'Show runtime logs of the app (or build logs with --build)',
  builder: yargs =>
    json_option(yargs)
      .option('app', {
        alias: 'a',
        type: 'string',
        description: 'App id, name or slug (defaults to the linked app)'
      })
      .option('build', {
        type: 'boolean',
        default: false,
        description: 'Show the build output of the latest deployment instead'
      })
      .option('deployment', {
        alias: 'd',
        type: 'string',
        description: 'Scope to one deployment id'
      })
      .option('follow', {
        alias: 'f',
        type: 'boolean',
        default: false,
        description:
          'With --build: keep tailing the output while the build runs'
      })
      .option('tail', {
        alias: 'n',
        type: 'number',
        description: 'Only the last N lines'
      })
      .example('$0 deploy logs', 'Runtime logs of the linked app (last 24h)')
      .example(
        '$0 deploy logs -d deployment_a1b2c3',
        'Runtime logs of ONE deployment (last 24h)'
      )
      .example(
        '$0 deploy logs --build',
        'Build output of the latest deployment'
      )
      .example(
        '$0 deploy logs --build -n 100',
        'The last 100 lines of the build — where a failure says why'
      )
      .example(
        '$0 deploy logs --build --follow',
        'Tail the build that is running right now'
      )
      .showHelpOnFail(false) as any,
  handler: async args => {
    if (args.follow && !args.build) {
      // Runtime logs have no follow mode (the API serves a 24h window, not a
      // stream) — only the build output can be tailed.
      throw new Error('--follow only works with --build')
    }
    if (args.follow && args.json) {
      throw new CliError('usage', '--follow streams text; it has no --json')
    }
    if (args.tail !== undefined && !(Number.isInteger(args.tail) && args.tail > 0)) {
      throw new CliError('usage', '--tail must be a positive integer')
    }
    const ctx = await requireApi()
    const app_id = await resolve_app_id(args.app, ctx.appId, ctx.api)
    const app = await ctx.api.getApp(app_id)

    if (args.build) {
      // Build output lives on the deployment. Default to the newest one —
      // exactly what you want after a red `faable deploy`.
      let deployment_id = args.deployment
      if (!deployment_id) {
        const deployments = await ctx.api.listDeployments(app_id, app.team)
        deployment_id = deployments[0]?.id
        if (!deployment_id) {
          if (args.json) {
            return print_json({
              deployment_id: null,
              content: null,
              truncated: false,
              omitted_lines: 0
            })
          }
          log.info(`📭 ${app.name} has no deployments yet.`)
          return
        }
      }
      if (args.follow) {
        // Live tail (the builder re-uploads the log every ~10s): same loop the
        // deploy command uses, so it ends at the image handoff and exits red
        // on BUILD_ERROR. On an already-settled deployment fall through to the
        // recorded snapshot instead of waiting on nothing.
        const deployment = await ctx.api.getDeployment(deployment_id)
        const phase = deployment?.status?.phase ?? ''
        if (FOLLOWABLE_PHASES.has(phase)) {
          log.info(`🏗️ Following the build of ${deployment_id}:`)
          await follow_remote_build(ctx.api, deployment_id)
          return
        }
        log.info(
          `Build of ${deployment_id} already finished (${phase}) — showing the recorded output.`
        )
      }

      const build = await ctx.api.getDeploymentLogs(deployment_id)
      const { content, omitted_lines } = tail_lines(
        build.content ?? '',
        args.tail
      )
      // `truncated`: the server cut the stored log; `omitted_lines`: --tail
      // left the head out. Different things, both worth knowing.
      if (args.json) {
        return print_json({
          deployment_id,
          content: build.content ? content : null,
          truncated: !!build.truncated,
          omitted_lines
        })
      }
      if (!build.content) {
        log.info(`📭 No build output recorded for ${deployment_id}.`)
        return
      }
      log.info(`🏗️ Build output of ${deployment_id}:`)
      if (omitted_lines) log.info(`(… ${omitted_lines} earlier lines)`)
      process.stdout.write(content)
      if (!content.endsWith('\n')) process.stdout.write('\n')
      if (build.truncated) log.warn(`(output truncated)`)
      return
    }

    const all = await ctx.api.getAppLogs(app_id, {
      deployment_id: args.deployment
    })
    // getAppLogs order is the api's; the tail is taken on time order.
    const sorted = [...all].sort((a, b) => Number(a[0]) - Number(b[0]))
    const lines = args.tail ? sorted.slice(-args.tail) : sorted
    // The api serves one window (24h, 200 lines): a list that never pages.
    if (args.json) return print_json(as_list(log_entries(lines)))
    // Say WHICH scope came back empty: with -d the 24h window is usually the
    // reason (a retired deployment stopped writing when it stopped serving).
    const scope = args.deployment
      ? `${args.deployment} (${app.name})`
      : `${app.name} (${app_id})`
    if (lines.length === 0) {
      log.info(`📭 No runtime logs in the last 24h for ${scope}.`)
      log.info(
        `For build output, use: faable deploy logs --build${
          args.deployment ? ` -d ${args.deployment}` : ''
        }`
      )
      return
    }
    log.info(
      `📜 Runtime logs of ${app.name}${
        args.deployment ? ` · ${args.deployment}` : ''
      } (last 24h, newest last):`
    )
    for (const line of format_log_lines(lines)) {
      process.stdout.write(line + '\n')
    }
  }
}
