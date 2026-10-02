import { CommandModule } from 'yargs'
import { requireApi } from '../../../api/context'
import { FaableApi, FaableDomain } from '../../../api/FaableApi'
import {
  ListArgs,
  fetch_page,
  list_options,
  more_hint,
  print,
  print_json
} from '../../../lib/listing'
import { log } from '../../../log'
import { requireProject } from '../../../api/project'
import { find_app_id } from '../resolve_app_id'
import { cname_target, dns_badge } from './format'

interface DomainsListArgs extends ListArgs {
  app?: string
}

export const domains_list: CommandModule<unknown, DomainsListArgs> = {
  command: 'list',
  describe: 'List custom domains of the app (or of the project, outside a linked repo)',
  builder: yargs =>
    list_options(yargs)
      .option('app', {
        alias: 'a',
        type: 'string',
        description: 'App id, name or slug (defaults to the linked app)'
      })
      .example(
        '$0 deploy domains list',
        'Domains of the linked app, or of the active project when there is none'
      )
      .showHelpOnFail(false) as any,
  handler: async args => {
    const ctx = await requireApi()
    const app_id = await find_app_id(args.app, ctx.appId, ctx.api)
    if (!app_id) return list_project_domains(ctx.api, args)
    const app = await ctx.api.getApp(app_id)
    const page = await fetch_page(
      p => ctx.api.listDomainsPage(app_id, app.team, p),
      args
    )
    if (args.json) return print_json(page)
    const domains = page.data

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
      print(`  ${domain.fqdn.padEnd(width)}  ${dns_badge(domain)}  (${tls})`)
    }
    const hint = more_hint(page)
    if (hint) log.info(hint)
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

// No app here (an unlinked directory): the domains of the active project,
// each with the app it routes to.
const list_project_domains = async (
  api: FaableApi,
  args: DomainsListArgs
) => {
  const { id: project } = await requireProject(api)
  const page = await fetch_page(
    p => api.listDomainsPage(undefined, project, p),
    args
  )
  if (args.json) return print_json(page)
  const domains = page.data

  if (domains.length === 0) {
    log.info(`🌐 No custom domains in ${project}.`)
    log.info(`Add one with: faable deploy domains add <yourdomain.com> --app <app>.`)
    return
  }

  const apps = await fetch_page(p => api.listApps(p, project), {
    limit: 200,
    all: true
  })
  const app_name = new Map(apps.data.map(a => [a.id, a.name]))
  const label = (d: FaableDomain) =>
    d.app_id ? app_name.get(d.app_id) ?? d.app_id : '(no app)'

  log.info(`🌐 ${domains.length} domain(s) in ${project}:`)
  const width = Math.max(...domains.map(d => d.fqdn.length))
  const app_width = Math.max(...domains.map(d => label(d).length))
  for (const domain of domains) {
    const tls = domain.tls ? 'tls' : 'no-tls'
    print(
      `  ${domain.fqdn.padEnd(width)}  ${label(domain).padEnd(app_width)}  ${dns_badge(domain)}  (${tls})`
    )
  }
  const hint = more_hint(page)
  if (hint) log.info(hint)
}
