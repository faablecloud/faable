import { CommandModule } from 'yargs'
import { requireApi } from '../../../api/context'
import { json_option, print_json } from '../../../lib/listing'
import { resolve_app_id } from '../resolve_app_id'
import { IP_OPTION, add_rule, check_selector } from './add_rule'

interface WafMonitorArgs {
  pattern?: string
  userAgent?: string
  query?: string
  ip?: string
  app?: string
  description?: string
  force?: boolean
  json?: boolean
}

export const waf_monitor: CommandModule<unknown, WafMonitorArgs> = {
  command: 'monitor [pattern]',
  describe:
    'Watch what a rule would stop, without blocking anything (try it before `block`)',
  builder: yargs =>
    json_option(yargs)
      .positional('pattern', {
        type: 'string',
        description:
          'Anchored path regex, e.g. ^/admin (quote it in your shell)'
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
      .option('ip', IP_OPTION)
      .option('app', {
        alias: 'a',
        type: 'string',
        description: 'App id, name or slug (defaults to the linked app)'
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
      .check((a: any) => check_selector('monitor', a))
      .example(
        "$0 deploy waf monitor '^/admin'",
        'See which requests a block on /admin would refuse, before refusing any'
      )
      .example(
        '$0 deploy waf monitor --user-agent python-requests',
        'Check that a user-agent rule would only catch the clients you mean'
      )
      .example(
        '$0 deploy waf monitor --ip 203.0.113.0/24',
        'See what a block on that network would refuse, before refusing it'
      )
      .epilogue(
        'A monitor rule blocks nothing: every request still reaches your app. ' +
          'Faable checks it against the traffic your app served, the past ' +
          'included, and the Firewall tab shows what it would have stopped. ' +
          'When it only catches what it should, add the same rule with `block` ' +
          'or `sink` and remove the monitor one.'
      )
      .showHelpOnFail(false) as any,
  handler: async args => {
    const ctx = await requireApi()
    const app_id = await resolve_app_id(args.app, ctx.appId, ctx.api)
    const app = await ctx.api.getApp(app_id)

    const waf = await add_rule({
      api: ctx.api,
      app_id,
      app_name: app.name,
      app_url: app.url,
      pattern: args.pattern,
      user_agent: args.userAgent,
      query: args.query,
      ip: args.ip,
      action: 'monitor',
      description: args.description,
      force: args.force,
      json: args.json
    })
    if (args.json) print_json(waf)
  }
}
