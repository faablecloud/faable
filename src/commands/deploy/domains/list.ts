import { CommandModule } from 'yargs'
import { requireApi } from '../../../api/context'
import { log } from '../../../log'
import { resolve_app_id } from '../resolve_app_id'
import { cname_target, dns_badge } from './format'

interface DomainsListArgs {
  app?: string
}

export const domains_list: CommandModule<unknown, DomainsListArgs> = {
  command: 'list',
  describe: 'List custom domains of the app',
  builder: yargs =>
    yargs
      .option('app', {
        alias: 'a',
        type: 'string',
        description: 'App Identifier (defaults to the linked app)'
      })
      .example('$0 deploy domains list', 'Domains of the linked app')
      .showHelpOnFail(false) as any,
  handler: async args => {
    const ctx = await requireApi()
    const app_id = await resolve_app_id(args.app, ctx.appId, ctx.api)
    const app = await ctx.api.getApp(app_id)
    const domains = await ctx.api.listDomains(app_id, app.team)

    if (domains.length === 0) {
      log.info(`🌐 No custom domains for ${app.name} (${app_id}).`)
      log.info(
        `Add one with: faable deploy domains add <yourdomain.com>. The app is always live at https://${app.url}.`
      )
      return
    }

    log.info(`🌐 ${domains.length} domain(s) for ${app.name} (${app_id}):`)
    const width = Math.max(...domains.map(d => d.fqdn.length))
    for (const domain of domains) {
      const tls = domain.tls ? 'tls' : 'no-tls'
      log.info(`  ${domain.fqdn.padEnd(width)}  ${dns_badge(domain)}  (${tls})`)
    }
    const unverified = domains.filter(d => !d.verified)
    if (unverified.length > 0) {
      log.info(``)
      log.info(`To finish verification, point each domain at Faable with a CNAME:`)
      for (const domain of unverified) {
        log.info(`  ${domain.fqdn} → ${cname_target(domain)}`)
      }
      log.info(`Run "faable deploy domains check <fqdn>" to see the diagnostic.`)
    }
  }
}
