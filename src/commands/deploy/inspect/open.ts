import openBrowser from 'open'
import { CommandModule } from 'yargs'
import { requireApi } from '../../../api/context'
import { log } from '../../../log'
import { resolve_app_id } from '../resolve_app_id'

interface OpenArgs {
  app?: string
  dashboard?: boolean
}

export const open_app: CommandModule<unknown, OpenArgs> = {
  command: 'open',
  describe: 'Open the app in the browser',
  builder: yargs =>
    yargs
      .option('app', {
        alias: 'a',
        type: 'string',
        description: 'App Identifier (defaults to the linked app)'
      })
      .option('dashboard', {
        type: 'boolean',
        default: false,
        description: 'Open the Faable dashboard page of the app instead'
      })
      .example('$0 deploy open', 'Open the live app URL')
      .example('$0 deploy open --dashboard', 'Open the app in the dashboard')
      .showHelpOnFail(false) as any,
  handler: async args => {
    const ctx = await requireApi()
    const app_id = await resolve_app_id(args.app, ctx.appId, ctx.api)
    const app = await ctx.api.getApp(app_id)

    const url = args.dashboard
      ? `https://dashboard.faable.com/deploy/${app.team}/app/${app.id}`
      : `https://${app.url}`
    log.info(`🌍 Opening ${url}`)
    await openBrowser(url).catch(() => {
      log.warn(`Could not open the browser automatically — visit: ${url}`)
    })
  }
}
