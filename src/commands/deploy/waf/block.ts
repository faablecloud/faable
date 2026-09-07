import { CommandModule } from 'yargs'
import { requireApi } from '../../../api/context'
import { resolve_app_id } from '../resolve_app_id'
import { add_rule } from './add_rule'

interface WafBlockArgs {
  pattern: string
  app?: string
  description?: string
}

export const waf_block: CommandModule<unknown, WafBlockArgs> = {
  command: 'block <pattern>',
  describe: 'Block a path at the edge with a 403 (never reaches your app)',
  builder: yargs =>
    yargs
      .positional('pattern', {
        type: 'string',
        demandOption: true,
        description:
          'Anchored path regex, e.g. ^/\\.well-known/ (quote it in your shell)'
      })
      .option('app', {
        alias: 'a',
        type: 'string',
        description: 'App Identifier (defaults to the linked app)'
      })
      .option('description', {
        alias: 'd',
        type: 'string',
        description: 'Why this rule exists (shown in `waf list`)'
      })
      .example(
        "$0 deploy waf block '^/\\.well-known/'",
        'Stop scanner probes under /.well-known from waking the app'
      )
      .showHelpOnFail(false) as any,
  handler: async args => {
    const ctx = await requireApi()
    const app_id = await resolve_app_id(args.app, ctx.appId, ctx.api)
    const app = await ctx.api.getApp(app_id)

    await add_rule({
      api: ctx.api,
      app_id,
      app_name: app.name,
      app_url: app.url,
      pattern: args.pattern,
      action: 'deny',
      description: args.description
    })
  }
}
