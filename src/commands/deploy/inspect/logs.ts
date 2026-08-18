import { CommandModule } from 'yargs'
import { requireApi } from '../../../api/context'
import { log } from '../../../log'
import { follow_remote_build } from '../remote/follow'
import { resolve_app_id } from '../resolve_app_id'
import { format_log_lines } from './format'

interface LogsArgs {
  app?: string
  build?: boolean
  deployment?: string
  follow?: boolean
}

// Phases where the build is still producing output; anything else is a frozen
// record and following would just wait on nothing.
const FOLLOWABLE_PHASES = new Set(['UNKNOWN', 'QUEUED', 'BUILDING'])

export const logs: CommandModule<unknown, LogsArgs> = {
  command: 'logs',
  describe: 'Show runtime logs of the app (or build logs with --build)',
  builder: yargs =>
    yargs
      .option('app', {
        alias: 'a',
        type: 'string',
        description: 'App Identifier (defaults to the linked app)'
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
      .example('$0 deploy logs', 'Runtime logs of the linked app (last 24h)')
      .example('$0 deploy logs --build', 'Build output of the latest deployment')
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
      if (!build.content) {
        log.info(`📭 No build output recorded for ${deployment_id}.`)
        return
      }
      log.info(`🏗️ Build output of ${deployment_id}:`)
      process.stdout.write(build.content)
      if (!build.content.endsWith('\n')) process.stdout.write('\n')
      if (build.truncated) log.warn(`(output truncated)`)
      return
    }

    const lines = await ctx.api.getAppLogs(app_id, {
      deployment_id: args.deployment
    })
    if (lines.length === 0) {
      log.info(
        `📭 No runtime logs in the last 24h for ${app.name} (${app_id}).`
      )
      log.info(`For build output, use: faable deploy logs --build`)
      return
    }
    log.info(`📜 Runtime logs of ${app.name} (last 24h, newest last):`)
    for (const line of format_log_lines(lines)) {
      process.stdout.write(line + '\n')
    }
  }
}
