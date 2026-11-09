import { CommandModule } from 'yargs'
import { requireApi } from '../../../api/context'
import { confirm } from '../../../lib/interactive'
import { json_option, print_json } from '../../../lib/listing'
import { log } from '../../../log'
import { resolve_app_id } from '../resolve_app_id'
import { cname_target } from './format'
import { attach_plan, locate_domain } from './locate'

interface DomainsAttachArgs {
  fqdn: string
  app?: string
  yes?: boolean
  json?: boolean
}

export const domains_attach: CommandModule<unknown, DomainsAttachArgs> = {
  command: 'attach <fqdn>',
  describe:
    'Link a domain of the project to an app — one left with no app, or one moving from another app',
  builder: yargs =>
    json_option(yargs)
      .positional('fqdn', {
        type: 'string',
        demandOption: true,
        description: 'A domain already in the project'
      })
      .option('app', {
        alias: 'a',
        type: 'string',
        description: 'App id, name or slug (defaults to the linked app)'
      })
      .option('yes', {
        alias: 'y',
        type: 'boolean',
        default: false,
        description:
          'Skip the confirmation when the domain moves from another app'
      })
      .example(
        '$0 deploy domains attach app.example.com --app web',
        'Serve a domain whose app was deleted from "web"'
      )
      .epilog(
        'The domain keeps its id, its CNAME target and its TLS certificate: no DNS change and no new certificate. Deleting an app leaves its domains in the project with no app; this links them again.'
      )
      .showHelpOnFail(false) as any,
  handler: async args => {
    const ctx = await requireApi()
    const app_id = await resolve_app_id(args.app, ctx.appId, ctx.api)
    const app = await ctx.api.getApp(app_id)
    // Any domain of the project: `locate_domain` without an app restriction.
    const found = await locate_domain(ctx.api, app.team, args.fqdn, null)
    const plan = attach_plan(found, app_id)

    if (plan.kind === 'already') {
      if (args.json) return print_json(plan.domain)
      log.info(
        `🌐 ${plan.domain.fqdn} is already attached to ${app.name} (${app_id}).`
      )
      return
    }

    if (plan.from) {
      const go = await confirm({
        message: `Move domain "${found.fqdn}" from ${plan.from} to ${app.name} (${app_id})? ${plan.from} stops serving it.`,
        yes: args.yes
      })
      if (!go) {
        log.info('Cancelled.')
        return
      }
    }

    const domain = await ctx.api.updateDomain(found.id, app.team, { app_id })
    if (args.json) return print_json(domain)
    log.info(
      `🔗 ${domain.fqdn} now serves ${app.name} (${app_id})${plan.from ? `, instead of ${plan.from}` : ''}.`
    )
    log.info(
      `Same CNAME (${domain.fqdn} → ${cname_target(domain)}) and the same certificate: nothing to change at your DNS provider.`
    )
  }
}
