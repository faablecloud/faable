import { CommandModule } from 'yargs'
import { requireApi } from '../../../api/context'
import { json_option, print_json } from '../../../lib/listing'
import { resolve_app_id } from '../resolve_app_id'
import { add_rule } from './add_rule'

interface WafAllowArgs {
  pattern: string
  app?: string
  description?: string
  json?: boolean
}

/**
 * The one WAF rule that opens instead of closing: paths of THIS app that Faable
 * blocks for every app (archives, dotfiles, config files) and that this app
 * really serves — a `.zip` download, say. Path only: a user-agent or query
 * exception could be claimed by anyone sending that header.
 */
export const waf_allow: CommandModule<unknown, WafAllowArgs> = {
  command: 'allow <pattern>',
  describe:
    'Let a path Faable blocks for every app (e.g. *.zip) reach your app',
  builder: yargs =>
    json_option(yargs)
      .positional('pattern', {
        type: 'string',
        demandOption: true,
        description:
          'Anchored path regex, e.g. ^/downloads/.*\\.zip$ (quote it in your shell)'
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
      .example(
        "$0 deploy waf allow '^/downloads/.*\\.zip$'",
        'Serve the .zip files under /downloads that Faable would otherwise refuse'
      )
      .epilogue(
        'Faable refuses some paths for every app before they reach it — ' +
          'archives like .zip or .tar.gz, dotfiles, config files — because ' +
          'scanners request them by the thousand. If your app really serves ' +
          'one, allow exactly that path. Keep the pattern narrow: your own ' +
          'block and sink rules still win over it, and it can never cover ' +
          '/.well-known/acme-challenge, /.faable or /_next.'
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
      action: 'allow',
      description: args.description,
      json: args.json
    })
    if (args.json) print_json(waf)
  }
}
