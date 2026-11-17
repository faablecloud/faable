import { CommandModule } from 'yargs'
import { requireApi } from '../../../api/context'
import { json_option, print_json } from '../../../lib/listing'
import { resolve_app_id } from '../resolve_app_id'
import { IP_OPTION, add_rule, check_selector, refuse_ip } from './add_rule'
import { parse_rate } from './rate'

type Action = 'deny' | 'sink' | 'monitor' | 'limit' | 'allow'

interface WafAddArgs {
  action: Action
  pattern?: string
  userAgent?: string
  query?: string
  ip?: string
  rate?: string
  burst?: number
  per?: 'ip' | 'rule'
  app?: string
  description?: string
  force?: boolean
  json?: boolean
}

/**
 * Every WAF rule through one command, with the action as a flag: the entry
 * point of the MCP's add_waf_rule (one tool is one CLI command). People use
 * the verbs (`block`, `sink`, `monitor`, `limit`, `allow`), so it is hidden
 * from --help; it runs the same checks and the same readback as they do.
 *
 * The pattern is a flag here, not a positional: glued with `=` it can never
 * be read as a flag of its own, whatever text the model passes.
 */
export const waf_add: CommandModule<unknown, WafAddArgs> = {
  command: 'add',
  describe: false,
  builder: yargs =>
    json_option(yargs)
      .option('action', {
        choices: ['deny', 'sink', 'monitor', 'limit', 'allow'] as const,
        demandOption: true,
        description: 'deny → 403, sink → 404 from Faable, monitor, limit, allow'
      })
      // No -p: that is --project, for every command.
      .option('pattern', {
        type: 'string',
        description: 'Anchored path regex, e.g. ^/wp-admin'
      })
      .option('user-agent', {
        alias: 'u',
        type: 'string',
        description: 'RE2 fragment matched against User-Agent'
      })
      .option('query', {
        alias: 'q',
        type: 'string',
        description: 'Literal query parameter name'
      })
      .option('ip', IP_OPTION)
      .option('rate', {
        alias: 'r',
        type: 'string',
        description: 'limit only: e.g. 10/m or 5/s'
      })
      .option('burst', {
        alias: 'b',
        type: 'number',
        description: 'limit only: requests allowed at once'
      })
      .option('per', {
        choices: ['ip', 'rule'] as const,
        description: 'limit only: one count per client IP, or one shared'
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
          'Accept a user-agent that also matches a known crawler or monitor, or a query parameter that carries an auth flow'
      })
      .check((a: any) => {
        const verb =
          a.action === 'deny' ? 'block' : (a.action as Exclude<Action, 'deny'>)
        if (a.action === 'allow' || a.action === 'limit') {
          refuse_ip(a.action, a.ip)
        }
        if (a.action === 'allow' && (!a.pattern || a.userAgent || a.query)) {
          throw new Error(
            'An allow rule is a path pattern only (no user-agent, no query parameter).'
          )
        }
        check_selector(verb, a)
        if (a.action === 'limit') {
          if (!a.rate) throw new Error('A limit rule needs --rate, e.g. 10/m.')
          parse_rate(a.rate)
          if (a.burst !== undefined && (!(a.burst >= 1) || a.burst > 20000)) {
            throw new Error('--burst must be between 1 and 20000.')
          }
        } else if (a.rate || a.burst !== undefined || a.per) {
          throw new Error('--rate, --burst and --per are for limit rules only.')
        }
        return true
      })
      .showHelpOnFail(false) as any,
  handler: async args => {
    const ctx = await requireApi()
    const app_id = await resolve_app_id(args.app, ctx.appId, ctx.api)
    const app = await ctx.api.getApp(app_id)
    const rate = args.action === 'limit' ? parse_rate(args.rate!) : undefined

    const waf = await add_rule({
      api: ctx.api,
      app_id,
      app_name: app.name,
      app_url: app.url,
      pattern: args.pattern,
      user_agent: args.userAgent,
      query: args.query,
      ip: args.ip,
      action: args.action,
      ...(rate
        ? {
            rate: { ...rate, ...(args.burst ? { burst: args.burst } : {}) },
            per: args.per ?? 'ip'
          }
        : {}),
      description: args.description,
      force: args.force,
      json: args.json
    })
    if (args.json) print_json(waf)
  }
}
