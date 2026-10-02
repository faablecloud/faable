import { CommandModule } from 'yargs'
import { requireApi } from '../../../api/context'
import { json_option, print_json } from '../../../lib/listing'
import { log } from '../../../log'
import { resolve_app_id } from '../resolve_app_id'
import { cname_target, dns_badge, find_by_fqdn } from './format'

interface DomainsCheckArgs {
  fqdn: string
  app?: string
  json?: boolean
}

export const domains_check: CommandModule<unknown, DomainsCheckArgs> = {
  command: 'check <fqdn>',
  describe: 'Show the DNS verification status of a domain',
  builder: yargs =>
    json_option(yargs)
      .positional('fqdn', {
        type: 'string',
        demandOption: true,
        description: 'Domain to check'
      })
      .option('app', {
        alias: 'a',
        type: 'string',
        description: 'App id, name or slug (defaults to the linked app)'
      })
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

    // The record plus the one thing it does not carry: the CNAME to create.
    if (args.json) {
      return print_json({ ...domain, expected_cname: cname_target(domain) })
    }

    const status = domain.status
    log.info(`🌐 ${domain.fqdn} — ${dns_badge(domain)}`)
    log.info(`  Expected CNAME: ${domain.fqdn} → ${cname_target(domain)}`)
    if (status?.dns_observed?.length) {
      log.info(`  Observed:       ${status.dns_observed.join(', ')}`)
    } else {
      log.info(`  Observed:       (no CNAME resolved yet)`)
    }
    if (status?.dns_message) {
      log.info(`  Diagnostic:     ${status.dns_message}`)
    }
    if (status?.dns_checked_at) {
      log.info(`  Last checked:   ${status.dns_checked_at}`)
    }
    if (!domain.verified) {
      log.info(
        `Faable re-checks automatically — no action needed beyond the CNAME record.`
      )
    }
  }
}
