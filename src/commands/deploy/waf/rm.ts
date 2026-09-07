import { CommandModule } from 'yargs'
import { requireApi } from '../../../api/context'
import { log } from '../../../log'
import { resolve_app_id } from '../resolve_app_id'

interface WafRmArgs {
  pattern: string
  app?: string
}

export const waf_rm: CommandModule<unknown, WafRmArgs> = {
  command: 'rm <pattern>',
  describe: 'Remove one of your WAF rules',
  builder: yargs =>
    yargs
      .positional('pattern', {
        type: 'string',
        demandOption: true,
        description: 'The exact pattern to remove (see `faable deploy waf list`)'
      })
      .option('app', {
        alias: 'a',
        type: 'string',
        description: 'App Identifier (defaults to the linked app)'
      })
      .example(
        "$0 deploy waf rm '^/robots\\.txt$'",
        'Stop handling /robots.txt at the edge'
      )
      .showHelpOnFail(false) as any,
  handler: async args => {
    const ctx = await requireApi()
    const app_id = await resolve_app_id(args.app, ctx.appId, ctx.api)
    const app = await ctx.api.getApp(app_id)

    await ctx.api.removeAppWafRule(app_id, args.pattern)

    log.info(`🗑️  Removed ${args.pattern} from ${app.name} (${app_id}).`)
    log.info(
      `Requests for it reach your app again within ~20s, once the edge picks up the change.`
    )
  }
}
