import { CommandModule } from 'yargs'
import { requireApi } from '../../../api/context'
import { log } from '../../../log'
import { resolve_app_id } from '../resolve_app_id'
import { deployment_row } from './format'

interface DeploymentsArgs {
  app?: string
  limit?: number
}

export const deployments: CommandModule<unknown, DeploymentsArgs> = {
  command: 'deployments',
  describe: 'List recent deployments of the app',
  builder: yargs =>
    yargs
      .option('app', {
        alias: 'a',
        type: 'string',
        description: 'App Identifier (defaults to the linked app)'
      })
      .option('limit', {
        alias: 'n',
        type: 'number',
        default: 10,
        description: 'How many to show'
      })
      .showHelpOnFail(false) as any,
  handler: async args => {
    const ctx = await requireApi()
    const app_id = await resolve_app_id(args.app, ctx.appId, ctx.api)
    const app = await ctx.api.getApp(app_id)
    const rows = await ctx.api.listDeployments(app_id, app.team)

    if (rows.length === 0) {
      log.info(`📭 ${app.name} has no deployments yet.`)
      return
    }

    const shown = rows.slice(0, args.limit ?? 10)
    log.info(`🚀 Last ${shown.length} deployment(s) of ${app.name}:`)
    for (const d of shown) {
      const live = d.id === app.status?.deployment ? '  ← live' : ''
      log.info(`  ${deployment_row(d)}${live}`)
    }
    log.info(`Full record of one: faable deploy inspect <deployment_id>`)
  }
}
