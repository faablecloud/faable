import { CommandModule } from 'yargs'
import { requireApi } from '../../../api/context'
import { resolve_app_id } from '../resolve_app_id'
import { add_rule } from './add_rule'

interface WafSinkArgs {
  pattern?: string
  userAgent?: string
  query?: string
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
      .option('query', {
        alias: 'q',
        type: 'string',
        description:
          'Literal query parameter name, e.g. rest_route (not a regex). With a path, BOTH must match.'
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
          'Accept a user-agent that also matches a known search/AI crawler or uptime monitor, or a query parameter that carries an auth flow'
      })
      .check(({ pattern, userAgent, query }: any) => {
        if (userAgent && query) {
          throw new Error(
            'A rule can combine a path with --user-agent OR with --query, not both.'
          )
        }
        if (!pattern && !userAgent && !query) {
          throw new Error(
            'Give a path pattern, --user-agent, --query, or a path with one of them.\n' +
              "  e.g. faable deploy waf sink '^/wp-admin'\n" +
              '       faable deploy waf sink --user-agent YisouSpider\n' +
              '       faable deploy waf sink --query rest_route'
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
      query: args.query,
      action: 'sink',
      description: args.description,
      force: args.force
    })
  }
}
