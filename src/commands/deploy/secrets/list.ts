import { CommandModule } from 'yargs'
import { requireApi } from '../../../api/context'
import { log } from '../../../log'
import { resolve_app_id } from '../resolve_app_id'
import { mask_value } from './mask'

interface SecretsListArgs {
  app?: string
  show?: boolean
}

export const secrets_list: CommandModule<unknown, SecretsListArgs> = {
  command: 'list',
  describe: 'List app secrets (values masked by default)',
  builder: yargs =>
    yargs
      .option('app', {
        alias: 'a',
        type: 'string',
        description: 'App Identifier (defaults to the linked app)'
      })
      .option('show', {
        type: 'boolean',
        default: false,
        description: 'Reveal full secret values'
      })
      .example('$0 deploy secrets list', 'List secrets of the linked app (masked)')
      .example('$0 deploy secrets list --show', 'Reveal full values')
      .showHelpOnFail(false) as any,
  handler: async args => {
    const ctx = await requireApi()
    const app_id = await resolve_app_id(args.app, ctx.appId, ctx.api)
    const secrets = await ctx.api.getAppSecrets(app_id)

    if (secrets.length === 0) {
      log.info(`🔐 No secrets set for ${app_id}.`)
      return
    }

    log.info(`🔐 ${secrets.length} secret(s) for ${app_id}:`)
    const width = Math.max(...secrets.map(s => s.name.length))
    const sorted = [...secrets].sort((a, b) => a.name.localeCompare(b.name))
    for (const secret of sorted) {
      const value = args.show ? secret.value : mask_value(secret.value)
      const origin =
        secret.related_model === 'profile' ? '  (inherited from team profile)' : ''
      log.info(`  ${secret.name.padEnd(width)}  ${value}${origin}`)
    }
    if (!args.show) {
      log.info(`Use --show to reveal full values.`)
    }
  }
}
