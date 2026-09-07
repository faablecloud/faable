import { CommandModule } from 'yargs'
import { requireApi } from '../../../api/context'
import { resolve_app_id } from '../resolve_app_id'
import { add_rule } from './add_rule'

interface WafSinkArgs {
  pattern?: string
  userAgent?: string
  app?: string
  description?: string
  force?: boolean
}

export const waf_sink: CommandModule<unknown, WafSinkArgs> = {
  command: 'sink [pattern]',
  describe: 'Answer requests with a 404 from Faable, without waking your app',
  builder: yargs =>
    yargs
      .positional('pattern', {
        type: 'string',
        description:
          'Anchored path regex, e.g. ^/robots\\.txt$ (quote it in your shell)'
      })
      .option('user-agent', {
        alias: 'u',
        type: 'string',
        description:
          'RE2 fragment matched against User-Agent, e.g. YisouSpider. With a path, BOTH must match.'
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
      .option('force', {
        type: 'boolean',
        default: false,
        description:
          'Accept a user-agent that also matches a known search/AI crawler or uptime monitor'
      })
      .check(({ pattern, userAgent }: any) => {
        if (!pattern && !userAgent) {
          throw new Error(
            'Give a path pattern, --user-agent, or both.\n' +
              "  e.g. faable deploy waf sink '^/wp-admin'\n" +
              '       faable deploy waf sink --user-agent YisouSpider'
          )
        }
        return true
      })
      .example(
        "$0 deploy waf sink '^/robots\\.txt$'",
        'Let Faable answer /robots.txt with a 404 instead of starting your app'
      )
      .example(
        '$0 deploy waf sink --user-agent SemrushBot',
        'Answer one crawler with a 404 instead of waking the app for it'
      )
      .epilogue(
        'Use `sink` for requests your app would 404 anyway: Faable replies ' +
          'with the same 404, without the cold start. Use `block` instead ' +
          'when you want the request refused outright.'
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
      user_agent: args.userAgent,
      action: 'sink',
      description: args.description,
      force: args.force
    })
  }
}
