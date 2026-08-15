import prompts from 'prompts'
import { CommandModule } from 'yargs'
import { requireApi } from '../../../api/context'
import { log } from '../../../log'
import { resolve_app_id } from '../resolve_app_id'
import { find_by_fqdn } from './format'

interface DomainsRmArgs {
  fqdn: string
  app?: string
  yes?: boolean
}

export const domains_rm: CommandModule<unknown, DomainsRmArgs> = {
  command: 'rm <fqdn>',
  describe: 'Remove a custom domain from the app',
  builder: yargs =>
    yargs
      .positional('fqdn', {
        type: 'string',
        demandOption: true,
        description: 'Domain to remove'
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
      .example('$0 deploy domains rm www.example.com', 'Detach after confirmation')
      .showHelpOnFail(false) as any,
  handler: async args => {
    const ctx = await requireApi()
    const app_id = await resolve_app_id(args.app, ctx.appId, ctx.api)
    const app = await ctx.api.getApp(app_id)
    const domains = await ctx.api.listDomains(app_id, app.team)
    const domain = find_by_fqdn(domains, args.fqdn)
    if (!domain) {
      throw new Error(
        `Domain ${args.fqdn} is not attached to ${app_id}. List them with "faable deploy domains list".`
      )
    }

    if (!args.yes) {
      // In a non-TTY run without --yes, prompts resolves undefined → cancel.
      const { confirm } = await prompts({
        type: 'toggle',
        name: 'confirm',
        message: `Remove domain "${domain.fqdn}" from ${app.name} (${app_id})? Traffic to it will stop being served.`,
        initial: false,
        active: 'yes',
        inactive: 'no'
      })
      if (!confirm) {
        log.info('Cancelled.')
        return
      }
    }

    await ctx.api.deleteDomain(domain.id, app.team)
    log.info(`🗑️ Removed domain ${domain.fqdn} from ${app_id}.`)
    log.info(
      `The app stays live at https://${app.url}. Remember to delete the CNAME at your DNS provider.`
    )
  }
}
