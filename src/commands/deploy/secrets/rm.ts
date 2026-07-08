import prompts from 'prompts'
import { CommandModule } from 'yargs'
import { requireApi } from '../../../api/context'
import { log } from '../../../log'
import { resolve_app_id } from '../resolve_app_id'
import { remove_app_secret } from './merge'

interface SecretsRmArgs {
  name: string
  app?: string
  yes?: boolean
}

export const secrets_rm: CommandModule<unknown, SecretsRmArgs> = {
  command: 'rm <name>',
  describe: 'Remove a secret by name',
  builder: yargs =>
    yargs
      .positional('name', {
        type: 'string',
        demandOption: true,
        description: 'Secret name'
      })
      .option('app', {
        alias: 'a',
        type: 'string',
        description: 'App Identifier (defaults to the linked app)'
      })
      .option('yes', {
        alias: 'y',
        type: 'boolean',
        default: false,
        description: 'Skip the confirmation prompt'
      })
      .example('$0 deploy secrets rm API_KEY', 'Remove API_KEY after confirmation')
      .showHelpOnFail(false) as any,
  handler: async args => {
    const ctx = await requireApi()
    const app_id = await resolve_app_id(args.app, ctx.appId, ctx.api)

    // Mutations go through createbatch (replace-all), so compute the
    // remaining set first — this also rejects unknown names and secrets
    // inherited from the team profile.
    const app = await ctx.api.getApp(app_id)
    const secrets = await ctx.api.getAppSecrets(app_id)
    const remaining = remove_app_secret(secrets, args.name)

    if (!args.yes) {
      // In a non-TTY run without --yes, prompts resolves undefined → cancel.
      const { confirm } = await prompts({
        type: 'toggle',
        name: 'confirm',
        message: `Remove secret "${args.name}" from ${app_id}?`,
        initial: false,
        active: 'yes',
        inactive: 'no'
      })
      if (!confirm) {
        log.info('Cancelled.')
        return
      }
    }

    await ctx.api.createSecretsBatch(app.id, app.team, remaining)
    log.info(`🗑️ Removed secret ${args.name} from ${app_id}.`)
    log.info(`ℹ️ The app is restarting to apply the changes.`)
  }
}
