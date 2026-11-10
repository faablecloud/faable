import { CommandModule } from 'yargs'
import { requireApi } from '../../../api/context'
import { CliError } from '../../../lib/errors'
import { json_option, print_json } from '../../../lib/listing'
import { log } from '../../../log'
import { find_by_fqdn } from './format'
import { domain_scope, not_in_project, project_domains } from './locate'

interface DomainsRedirectArgs {
  fqdn: string
  target?: string
  off?: boolean
  app?: string
  json?: boolean
}

export const domains_redirect: CommandModule<unknown, DomainsRedirectArgs> = {
  command: 'redirect <fqdn> [target]',
  describe:
    'Make a domain redirect every request to another domain of the project (or serve again with --off)',
  builder: yargs =>
    json_option(yargs)
      .positional('fqdn', {
        type: 'string',
        demandOption: true,
        description: 'The domain that redirects'
      })
      .positional('target', {
        type: 'string',
        description: 'The domain it redirects to: same project, and one that serves'
      })
      .option('off', {
        type: 'boolean',
        default: false,
        description: 'Stop redirecting: the domain serves its app again'
      })
      .option('app', {
        alias: 'a',
        type: 'string',
        description:
          'App id, name or slug. Optional: the domain is looked up in the project'
      })
      .example(
        '$0 deploy domains redirect www.example.com example.com',
        'www.example.com/path?q → https://example.com/path?q'
      )
      .example(
        '$0 deploy domains redirect www.example.com --off',
        'www.example.com serves its app again'
      )
      .epilog(
        'GET gets a 301, every other method (HEAD included) a 308: the path and the query are kept. A domain redirects to the one it names, never further: no chains. Removing the target removes the domains that redirect to it.'
      )
      .showHelpOnFail(false) as any,
  handler: async args => {
    if (!args.off && !args.target) {
      throw new CliError(
        'usage',
        'Name the domain to redirect to, or pass --off to stop redirecting.'
      )
    }
    if (args.off && args.target) {
      throw new CliError(
        'usage',
        'Pass either a target or --off, not both.'
      )
    }
    const ctx = await requireApi()
    const scope = await domain_scope(ctx.api, args.app, ctx.appId)
    const all = await project_domains(ctx.api, scope.team)
    const domain = find_by_fqdn(all, args.fqdn)
    if (!domain) throw not_in_project(args.fqdn, scope.team)

    const target = args.off ? null : args.target!.toLowerCase()
    if ((domain.redirect ?? null) === target) {
      if (args.json) return print_json(domain)
      log.info(
        target
          ? `↪ ${domain.fqdn} already redirects to ${target}.`
          : `🌐 ${domain.fqdn} already serves its app: it redirects nowhere.`
      )
      return
    }

    // The api checks the target (same project, serving, no chains) and says
    // why in its error; this only spares the round trip for the plain typo.
    if (target && !find_by_fqdn(all, target)) {
      throw new CliError(
        'domain_redirect_invalid',
        `${target} is not a domain of this project. Add it first with "faable deploy domains add ${target}": a domain can only redirect to another domain of the same project.`
      )
    }

    const updated = await ctx.api.updateDomain(domain.id, scope.team, {
      redirect: target
    })
    if (args.json) return print_json(updated)
    if (target) {
      log.info(
        `↪ ${updated.fqdn} now redirects to ${target}: GET → 301, other methods → 308, path and query kept.`
      )
      log.info(
        `Removing ${target} will remove ${updated.fqdn} too. Its CNAME and certificate stay as they are.`
      )
    } else {
      log.info(
        `🌐 ${updated.fqdn} no longer redirects: it serves ${updated.app_id ?? 'no app (link one with "faable deploy domains attach")'}.`
      )
    }
  }
}
