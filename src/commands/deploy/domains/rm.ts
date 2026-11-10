import { CommandModule } from 'yargs'
import { requireApi } from '../../../api/context'
import { confirm } from '../../../lib/interactive'
import { json_option, print_json } from '../../../lib/listing'
import { log } from '../../../log'
import { redirects_to } from './format'
import { domain_scope, locate_domain, project_domains } from './locate'

interface DomainsRmArgs {
  fqdn: string
  app?: string
  yes?: boolean
  json?: boolean
}

export const domains_rm: CommandModule<unknown, DomainsRmArgs> = {
  command: 'rm <fqdn>',
  describe: 'Remove a custom domain (from its app, or one linked to no app)',
  builder: yargs =>
    json_option(yargs)
      .positional('fqdn', {
        type: 'string',
        demandOption: true,
        description: 'Domain to remove'
      })
      .option('app', {
        alias: 'a',
        type: 'string',
        description:
          'App id, name or slug. Optional: the domain is looked up in the project'
      })
      .option('yes', {
        alias: 'y',
        type: 'boolean',
        default: false,
        description: 'Skip the confirmation prompt'
      })
      .example(
        '$0 deploy domains rm www.example.com',
        'Detach after confirmation'
      )
      .example(
        '$0 deploy domains rm app.example.com -p my-project -y',
        'A domain linked to no app (its app was deleted). To keep it, link it instead: domains attach'
      )
      .showHelpOnFail(false) as any,
  handler: async args => {
    const ctx = await requireApi()
    const scope = await domain_scope(ctx.api, args.app, ctx.appId)
    const domain = await locate_domain(
      ctx.api,
      scope.team,
      args.fqdn,
      scope.explicit
    )
    const serves = domain.app_id
      ? scope.app?.id === domain.app_id
        ? `${scope.app.name} (${domain.app_id})`
        : domain.app_id
      : null

    // The domains that redirect to it go with it (the api cascades): say so
    // before, not after.
    const dependents = redirects_to(
      await project_domains(ctx.api, scope.team),
      domain
    )
    const also = dependents.length
      ? ` ${dependents.map(d => d.fqdn).join(', ')} redirect${dependents.length === 1 ? 's' : ''} to it and will be removed too.`
      : ''

    const go = await confirm({
      message: serves
        ? `Remove domain "${domain.fqdn}" from ${serves}? Traffic to it will stop being served.${also}`
        : `Remove domain "${domain.fqdn}"? It is linked to no app. To serve it again with the same CNAME and certificate, use "faable deploy domains attach" instead.${also}`,
      yes: args.yes
    })
    if (!go) {
      log.info('Cancelled.')
      return
    }

    await ctx.api.deleteDomain(domain.id, scope.team)
    if (args.json) {
      return print_json({
        deleted: true,
        id: domain.id,
        fqdn: domain.fqdn,
        also_deleted: dependents.map(d => ({ id: d.id, fqdn: d.fqdn }))
      })
    }
    log.info(
      `🗑️ Removed domain ${domain.fqdn}${serves ? ` from ${serves}` : ''}${dependents.length ? `, and ${dependents.map(d => d.fqdn).join(', ')} that redirected to it` : ''}.`
    )
    log.info(
      `Remember to delete the CNAME${dependents.length ? 's' : ''} at your DNS provider.`
    )
  }
}
