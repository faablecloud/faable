import { CommandModule } from 'yargs'
import { requireApi } from '../../../api/context'
import {
  ListArgs,
  fetch_page,
  list_options,
  more_hint,
  print,
  print_json
} from '../../../lib/listing'
import { log } from '../../../log'
import { resolve_app_id } from '../resolve_app_id'
import { deployment_row } from './format'

interface DeploymentsArgs extends ListArgs {
  app?: string
}

export const deployments: CommandModule<unknown, DeploymentsArgs> = {
  command: 'deployments',
  describe: 'List recent deployments of the app',
  builder: yargs =>
    list_options(yargs, { default_limit: 10 })
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
    const page = await fetch_page(
      p => ctx.api.listDeploymentsPage(app_id, app.team, p),
      args
    )
    if (args.json) return print_json(page)

    if (page.data.length === 0) {
      log.info(`📭 ${app.name} has no deployments yet.`)
      return
    }

    log.info(`🚀 Last ${page.data.length} deployment(s) of ${app.name}:`)
    for (const d of page.data) {
      const live = d.id === app.status?.deployment ? '  ← live' : ''
      print(`  ${deployment_row(d)}${live}`)
    }
    const hint = more_hint(page)
    if (hint) log.info(hint)
    log.info(`Full record of one: faable deploy inspect <deployment_id>`)
  }
}
