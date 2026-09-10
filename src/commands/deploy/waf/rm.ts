import { CommandModule } from 'yargs'
import { requireApi } from '../../../api/context'
import { log } from '../../../log'
import { resolve_app_id } from '../resolve_app_id'
import { describe_selector } from './add_rule'

interface WafRmArgs {
  pattern?: string
  userAgent?: string
  query?: string
  action?: 'deny' | 'sink'
  app?: string
}

export const waf_rm: CommandModule<unknown, WafRmArgs> = {
  command: 'rm [pattern]',
  describe: 'Remove one of your WAF rules',
  builder: yargs =>
    yargs
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
      .option('action', {
        type: 'string',
        choices: ['deny', 'sink'] as const,
        description: 'Only needed when the same rule exists as both'
      })
      .option('app', {
        alias: 'a',
        type: 'string',
        description: 'App Identifier (defaults to the linked app)'
      })
      .check(({ pattern, userAgent, query }: any) => {
        if (!pattern && !userAgent && !query) {
          throw new Error(
            'Give the path pattern, --user-agent, --query, or a path with one of them.'
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
      .showHelpOnFail(false) as any,
  handler: async args => {
    const ctx = await requireApi()
    const app_id = await resolve_app_id(args.app, ctx.appId, ctx.api)
    const app = await ctx.api.getApp(app_id)

    await ctx.api.removeAppWafRule(app_id, {
      pattern: args.pattern,
      user_agent: args.userAgent,
      query: args.query,
      action: args.action
    })

    log.info(
      `🗑️  Removed ${describe_selector({
        pattern: args.pattern,
        user_agent: args.userAgent,
        query: args.query
      })} from ${app.name} (${app_id}).`
    )
    log.info(
      `They reach your app again within ~20s, once the edge picks up the change.`
    )
  }
}
