import { CommandModule } from 'yargs'
import { requireApi } from '../../../api/context'
import { json_option, print_json } from '../../../lib/listing'
import { resolve_app_id } from '../resolve_app_id'
import { add_rule } from './add_rule'
import { parse_rate } from './rate'

interface WafLimitArgs {
  pattern?: string
  userAgent?: string
  query?: string
  rate: string
  burst?: number
  per: 'ip' | 'rule'
  app?: string
  description?: string
  force?: boolean
  json?: boolean
}

export const waf_limit: CommandModule<unknown, WafLimitArgs> = {
  command: 'limit [pattern]',
  describe:
    'Rate-limit matching requests: over the limit they get a 429 at the edge',
  builder: yargs =>
    json_option(yargs)
      .positional('pattern', {
        type: 'string',
        description:
          'Anchored path regex, e.g. ^/api/login$ (quote it in your shell)'
      })
      .option('rate', {
        alias: 'r',
        type: 'string',
        demandOption: true,
        description:
          'Requests allowed per second or per minute, e.g. 10/m or 5/s'
      })
      .option('burst', {
        alias: 'b',
        type: 'number',
        description:
          'Requests allowed at once before the rate applies (defaults to the rate)'
      })
      .option('per', {
        choices: ['ip', 'rule'] as const,
        default: 'ip' as const,
        description:
          'ip: each client IP has its own count. rule: one count shared by every client (per domain of the app).'
      })
      .option('user-agent', {
        alias: 'u',
        type: 'string',
        description:
          'RE2 fragment matched against User-Agent, e.g. GPTBot. With a path, BOTH must match.'
      })
      .option('query', {
        alias: 'q',
        type: 'string',
        description:
          'Literal query parameter name, e.g. s (not a regex). With a path, BOTH must match.'
      })
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
      .check(({ pattern, userAgent, query, rate, burst }: any) => {
        if (userAgent && query) {
          throw new Error(
            'A rule can combine a path with --user-agent OR with --query, not both.'
          )
        }
        if (!pattern && !userAgent && !query) {
          throw new Error(
            'Give a path pattern, --user-agent, --query, or a path with one of them.\n' +
              "  e.g. faable deploy waf limit '^/api/login$' --rate 10/m\n" +
              '       faable deploy waf limit --user-agent GPTBot --rate 60/m --per rule'
          )
        }
        parse_rate(rate)
        if (burst !== undefined && (!(burst >= 1) || burst > 20000)) {
          throw new Error('--burst must be between 1 and 20000.')
        }
        return true
      })
      .example(
        "$0 deploy waf limit '^/api/login$' --rate 10/m",
        '10 login attempts per minute per IP; the 11th gets a 429'
      )
      .example(
        "$0 deploy waf limit '^/search' --rate 5/s --burst 20",
        'Searches at 5 per second per IP, with room for a burst of 20'
      )
      .example(
        '$0 deploy waf limit --user-agent GPTBot --rate 60/m --per rule --force',
        'Slow a crawler down to 60 requests a minute in total, instead of blocking it'
      )
      .epilogue(
        'Requests within the limit reach your app as usual. Over it, Faable ' +
          'answers 429 at the edge, so they do not wake a sleeping app. Your ' +
          'own block and sink rules still win over a limit. Change a limit by ' +
          'running the same command with a new --rate.'
      )
      .showHelpOnFail(false) as any,
  handler: async args => {
    const ctx = await requireApi()
    const app_id = await resolve_app_id(args.app, ctx.appId, ctx.api)
    const app = await ctx.api.getApp(app_id)
    const rate = parse_rate(args.rate)

    const waf = await add_rule({
      api: ctx.api,
      app_id,
      app_name: app.name,
      app_url: app.url,
      pattern: args.pattern,
      user_agent: args.userAgent,
      query: args.query,
      action: 'limit',
      rate: { ...rate, ...(args.burst ? { burst: args.burst } : {}) },
      per: args.per,
      description: args.description,
      force: args.force,
      json: args.json
    })
    if (args.json) print_json(waf)
  }
}
