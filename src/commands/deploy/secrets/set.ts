import { CommandModule } from 'yargs'
import { requireApi } from '../../../api/context'
import { log } from '../../../log'
import { resolve_app_id } from '../resolve_app_id'
import { merge_app_secrets } from './merge'
import { parse_pairs } from './parse_pairs'

interface SecretsSetArgs {
  pairs: string[]
  app?: string
}

export const secrets_set: CommandModule<unknown, SecretsSetArgs> = {
  command: 'set <pairs...>',
  describe: 'Set one or more secrets as KEY=VALUE',
  builder: yargs =>
    yargs
      .positional('pairs', {
        type: 'string',
        array: true,
        demandOption: true,
        description: 'KEY=VALUE pairs (quote values containing spaces)'
      })
      .option('app', {
        alias: 'a',
        type: 'string',
        description: 'App Identifier (defaults to the linked app)'
      })
      .example('$0 deploy secrets set API_KEY=abc123', 'Set a single secret')
      .example(
        '$0 deploy secrets set A=1 DB_URL=postgres://u:p@host/db',
        'Set several at once (values may contain "=")'
      )
      .showHelpOnFail(false) as any,
  handler: async args => {
    // Validate ALL pairs before writing ANY, so one malformed pair aborts the
    // whole command with no partial writes.
    const parsed = parse_pairs(args.pairs)

    const ctx = await requireApi()
    const app_id = await resolve_app_id(args.app, ctx.appId, ctx.api)

    // getApp also validates access to the app and provides the team the
    // batch endpoint requires as request context.
    const app = await ctx.api.getApp(app_id)
    const existing = await ctx.api.getAppSecrets(app_id)
    const merged = merge_app_secrets(existing, parsed)
    await ctx.api.createSecretsBatch(app.id, app.team, merged)

    const current = new Set(
      existing.filter(s => s.related_model === 'app').map(s => s.name)
    )
    for (const { name } of parsed) {
      log.info(
        current.has(name)
          ? `🔑 Updated secret ${name} on ${app_id}`
          : `🔑 Added secret ${name} to ${app_id}`
      )
    }
    log.info(`✅ ${parsed.length} secret(s) saved to ${app_id}.`)
    log.info(`ℹ️ The app is restarting to apply the changes.`)
  }
}
