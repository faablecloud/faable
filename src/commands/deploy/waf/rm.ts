import { CommandModule } from 'yargs'
import { requireApi } from '../../../api/context'
import { json_option, print_json } from '../../../lib/listing'
import { log } from '../../../log'
import { resolve_app_id } from '../resolve_app_id'
import { IP_OPTION, describe_selector } from './add_rule'

interface WafRmArgs {
  pattern?: string
  userAgent?: string
  query?: string
  ip?: string
  action?: 'deny' | 'sink' | 'allow' | 'monitor' | 'limit'
  app?: string
  json?: boolean
}

export const waf_rm: CommandModule<unknown, WafRmArgs> = {
  command: 'rm [pattern]',
  describe: 'Remove one of your WAF rules',
  builder: yargs =>
    json_option(yargs)
      .positional('pattern', {
        type: 'string',
        description:
          'The exact pattern to remove (see `faable deploy waf list`)'
      })
      // A rule is addressed by everything that defines it, not by its path
      // alone: "/login" and "/login for YisouSpider" are two different rules
      // that share a pattern, and removing one must not take out the other.
      .option('user-agent', {
        alias: 'u',
        type: 'string',
        description: 'The user-agent of the rule to remove'
      })
      .option('query', {
        alias: 'q',
        type: 'string',
        description: 'The query parameter of the rule to remove'
      })
      .option('ip', {
        ...IP_OPTION,
        description:
          'The IP or CIDR of the rule to remove (203.0.113.7/32 finds 203.0.113.7)'
      })
      .option('action', {
        type: 'string',
        choices: ['deny', 'sink', 'allow', 'monitor', 'limit'] as const,
        description: 'Only needed when the same rule exists as both'
      })
      .option('app', {
        alias: 'a',
        type: 'string',
        description: 'App id, name or slug (defaults to the linked app)'
      })
      .check(({ pattern, userAgent, query, ip }: any) => {
        if (!pattern && !userAgent && !query && !ip) {
          throw new Error(
            'Give the path pattern, --user-agent, --query, --ip, or a path with one of them.'
          )
        }
        return true
      })
      .example(
        "$0 deploy waf rm '^/robots\\.txt$'",
        'Stop handling /robots.txt at the edge'
      )
      .example(
        '$0 deploy waf rm --user-agent YisouSpider',
        'Stop blocking that crawler'
      )
      .example(
        '$0 deploy waf rm --ip 203.0.113.7',
        'Let that address through again'
      )
      .showHelpOnFail(false) as any,
  handler: async args => {
    const ctx = await requireApi()
    const app_id = await resolve_app_id(args.app, ctx.appId, ctx.api)
    const app = await ctx.api.getApp(app_id)

    const waf = await ctx.api.removeAppWafRule(app_id, {
      pattern: args.pattern,
      user_agent: args.userAgent,
      query: args.query,
      ...(args.ip ? { client_ip: args.ip } : {}),
      action: args.action
    })
    if (args.json) return print_json(waf)

    log.info(
      `🗑️  Removed ${describe_selector({
        pattern: args.pattern,
        user_agent: args.userAgent,
        query: args.query,
        ip: args.ip
      })} from ${app.name} (${app_id}).`
    )
    log.info(
      args.action === 'monitor'
        ? `It never blocked anything: those requests kept reaching your app.`
        : `They reach your app again within ~20s, once the edge picks up the change.`
    )
  }
}
