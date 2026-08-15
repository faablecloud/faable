import { CommandModule } from 'yargs'
import { requireApi } from '../../../api/context'
import { log } from '../../../log'
import { resolve_app_id } from '../resolve_app_id'
import { cname_target } from './format'

interface DomainsAddArgs {
  fqdn: string
  app?: string
  tls?: boolean
}

export const domains_add: CommandModule<unknown, DomainsAddArgs> = {
  command: 'add <fqdn>',
  describe: 'Add a custom domain to the app',
  builder: yargs =>
    yargs
      .positional('fqdn', {
        type: 'string',
        demandOption: true,
        description: 'Fully qualified domain name (e.g. www.example.com)'
      })
      .option('app', {
        alias: 'a',
        type: 'string',
        description: 'App Identifier (defaults to the linked app)'
      })
      .option('tls', {
        type: 'boolean',
        default: true,
        description: 'Provision a TLS certificate automatically (default)'
      })
      .example(
        '$0 deploy domains add www.example.com',
        'Attach www.example.com to the linked app'
      )
      .showHelpOnFail(false) as any,
  handler: async args => {
    const ctx = await requireApi()
    const app_id = await resolve_app_id(args.app, ctx.appId, ctx.api)
    const app = await ctx.api.getApp(app_id)

    const domain = await ctx.api.createDomain(app.team, {
      fqdn: args.fqdn,
      app_id,
      tls: args.tls
    })

    log.info(`🌐 Domain ${domain.fqdn} added to ${app.name} (${app_id}).`)
    log.info(``)
    log.info(`Now create a CNAME record at your DNS provider:`)
    log.info(`  ${domain.fqdn} → ${cname_target(domain)}`)
    log.info(``)
    log.info(
      `Faable verifies the record automatically once DNS propagates${
        args.tls ? ' and then provisions the TLS certificate' : ''
      }.`
    )
    log.info(`Track it with: faable deploy domains check ${domain.fqdn}`)
  }
}
