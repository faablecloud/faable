import { CommandModule } from 'yargs'
import { requireApi } from '../../../api/context'
import { resolve_app_id } from '../resolve_app_id'
import { add_rule } from './add_rule'

interface WafSinkArgs {
  pattern: string
  app?: string
  description?: string
}

export const waf_sink: CommandModule<unknown, WafSinkArgs> = {
  command: 'sink <pattern>',
  describe: 'Answer a path with a 404 from Faable, without waking your app',
  builder: yargs =>
    yargs
      .positional('pattern', {
        type: 'string',
        demandOption: true,
        description:
          'Anchored path regex, e.g. ^/robots\\.txt$ (quote it in your shell)'
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
        "$0 deploy waf sink '^/robots\\.txt$'",
        'Let Faable answer /robots.txt with a 404 instead of starting your app'
      )
      .epilogue(
        'Use `sink` for paths your app does not serve anyway: Faable replies ' +
          'with the same 404 your app would have, without the cold start. ' +
          'Use `block` instead when you want the request refused outright.'
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
      action: 'sink',
      description: args.description
    })
  }
}
