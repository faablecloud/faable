import { CommandModule } from 'yargs'
import { requireApi } from '../../../api/context'
import { log } from '../../../log'
import { resolve_app_id } from '../resolve_app_id'
import { format_waf } from './format'

interface WafListArgs {
  app?: string
}

export const waf_list: CommandModule<unknown, WafListArgs> = {
  command: 'list',
  describe: 'Show the WAF rules in effect for the app',
  builder: yargs =>
    yargs
      .option('app', {
        alias: 'a',
        type: 'string',
        description: 'App Identifier (defaults to the linked app)'
      })
      .example('$0 deploy waf list', 'Show the rules protecting the linked app')
      .showHelpOnFail(false) as any,
  handler: async args => {
    const ctx = await requireApi()
    const app_id = await resolve_app_id(args.app, ctx.appId, ctx.api)
    const app = await ctx.api.getApp(app_id)
    const waf = await ctx.api.getAppWaf(app_id)

    log.info(`🛡️  WAF for ${app.name} (${app_id})`)
    log.info(``)
    for (const line of format_waf(waf)) log.info(line)
  }
}
