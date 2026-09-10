import { CommandModule } from 'yargs'
import { requireApi } from '../../../api/context'
import { resolve_app_id } from '../resolve_app_id'
import { add_rule } from './add_rule'

interface WafBlockArgs {
  pattern?: string
  userAgent?: string
  query?: string
  app?: string
  description?: string
  force?: boolean
}

export const waf_block: CommandModule<unknown, WafBlockArgs> = {
  command: 'block [pattern]',
  describe: 'Block requests at the edge with a 403 (they never reach your app)',
  builder: yargs =>
    yargs
      .positional('pattern', {
        type: 'string',
        description:
          'Anchored path regex, e.g. ^/\\.well-known/ (quote it in your shell)'
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
              "  e.g. faable deploy waf block '^/wp-admin'\n" +
              '       faable deploy waf block --user-agent YisouSpider\n' +
              '       faable deploy waf block --query rest_route'
          )
        }
        return true
      })
      .example(
        "$0 deploy waf block '^/\\.well-known/'",
        'Stop scanner probes under /.well-known from waking the app'
      )
      .example(
        '$0 deploy waf block --user-agent YisouSpider',
        'Refuse one crawler outright, on every path'
      )
      .example(
        "$0 deploy waf block '^/api/' --user-agent curl",
        'Refuse /api/ to that user-agent only, leaving browsers untouched'
      )
      .example(
        '$0 deploy waf block --query rest_route',
        'Stop WordPress REST probes, whose payload rides in the query string'
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
      action: 'deny',
      description: args.description,
      force: args.force
    })
  }
}
