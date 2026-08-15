import { CommandModule } from 'yargs'
import { requireApi } from '../../../api/context'
import { log } from '../../../log'
import { resolve_app_id } from '../resolve_app_id'
import { detected_summary, phase_badge, short_commit, when } from './format'

interface StatusArgs {
  app?: string
}

export const status: CommandModule<unknown, StatusArgs> = {
  command: 'status',
  describe: 'Show what is live for the app',
  builder: yargs =>
    yargs
      .option('app', {
        alias: 'a',
        type: 'string',
        description: 'App Identifier (defaults to the linked app)'
      })
      .showHelpOnFail(false) as any,
  handler: async args => {
    const ctx = await requireApi()
    const app_id = await resolve_app_id(args.app, ctx.appId, ctx.api)
    const app = await ctx.api.getApp(app_id)
    const deployments = await ctx.api.listDeployments(app_id, app.team)
    const latest = deployments[0]

    log.info(`${phase_badge(app.status?.phase)}  ${app.name} (${app.id})`)
    log.info(`  URL:        https://${app.url}`)
    const stack = detected_summary(app.detected)
    if (stack) log.info(`  Stack:      ${stack}`)
    if (app.repository) {
      log.info(
        `  Repository: ${app.repository} (${app.github_branch || 'main'}${
          app.deploy_trigger === 'webhook' ? ', push-to-deploy' : ''
        })`
      )
    }
    if (app.status?.deployment) {
      log.info(`  Live:       ${app.status.deployment}`)
    }
    if (latest && latest.id !== app.status?.deployment) {
      log.info(
        `  Latest:     ${latest.id} — ${phase_badge(latest.status?.phase)} (${short_commit(latest.github_commit)}, ${when(latest.createdAt)})`
      )
      if (latest.status?.reason) {
        log.info(`  Reason:     ${latest.status.reason.split('\n')[0]}`)
        log.info(`  Full error: faable deploy logs --build`)
      }
    }
    if (deployments.length === 0) {
      log.info(`  No deployments yet — push to deploy, or run: faable deploy`)
    }
  }
}
