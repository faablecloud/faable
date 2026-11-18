import { CommandModule } from 'yargs'
import type { FaableInstallation } from '../../api/FaableApi'
import { requireApi } from '../../api/context'
import { requireProject } from '../../api/project'
import { CliError } from '../../lib/errors'
import { json_option, print_json } from '../../lib/listing'
import { log } from '../../log'
import { acme_record, cname_target } from './domains/format'
import {
  InstallWaitResult,
  app_name_from_title,
  catalog_lines,
  domain_problem,
  find_restorable,
  missing_fields,
  parse_inputs,
  restorable,
  restorable_lines,
  wait_for_installation
} from './install_lib'
import { reachable_timeout_ms, wait_reachable } from './reachable'

interface InstallArgs {
  app?: string
  installation?: string
  name?: string
  input?: string[]
  tier?: string
  domain?: string
  wait?: boolean
  timeout?: number
  json?: boolean
}

// `faable deploy install wordpress` — the dashboard's «Install an app»:
// installs an app of the Faable catalogue in the project (its App, a Volume
// for its files and a Database with daily backups; Hobby and Pro). Without
// an app, lists the catalogue: what can be installed and what each asks for.
export const install: CommandModule<unknown, InstallArgs> = {
  command: 'install [app] [installation]',
  describe:
    'Install an app from the Faable catalogue (WordPress…); without one, list the catalogue',
  builder: yargs =>
    json_option(yargs)
      .positional('app', {
        type: 'string',
        description:
          'Catalogue app to install (e.g. wordpress), or `restore` to bring back an uninstalled one'
      })
      .positional('installation', {
        type: 'string',
        description:
          'With restore: the uninstalled installation, by name or id; without it, list what can be restored'
      })
      .option('name', {
        alias: 'n',
        type: 'string',
        description:
          'Name of the app it creates (lowercase, digits and dashes); defaults to the site title as a slug'
      })
      .option('input', {
        alias: 'i',
        type: 'string',
        array: true,
        description:
          'What the app asks for, as name=value; repeat it (see `faable deploy install`)'
      })
      .option('tier', {
        type: 'string',
        description: "Database tier (db-s, db-m); defaults to the plan's"
      })
      .option('domain', {
        type: 'string',
        description:
          'Production domain of the site (e.g. www.example.com), besides its faable.link address; you configure its DNS'
      })
      .option('wait', {
        type: 'boolean',
        default: false,
        description: 'Wait until the installation is ready or fails'
      })
      .option('timeout', {
        type: 'number',
        default: 900,
        description: 'With --wait: give up waiting after this many seconds'
      })
      .example('$0 deploy install', 'List the apps you can install')
      .example(
        '$0 deploy install wordpress --input title="My blog" --wait',
        'Install WordPress (you are its admin) and wait until it is ready'
      )
      .example(
        '$0 deploy install wordpress --input title="My blog" --domain www.example.com',
        'Install it on your own domain; it prints the DNS record to create'
      )
      .example(
        '$0 deploy install restore my-blog --wait',
        'Bring back a WordPress you uninstalled (within 30 days, if its database was kept)'
      )
      .showHelpOnFail(false) as any,
  handler: async args => {
    if (args.app === 'restore') return restoreInstallation(args)
    const { api } = await requireApi()
    const catalog = await api.listBlueprints()

    if (!args.app) {
      if (args.json) return print_json(catalog)
      if (!catalog.length) {
        log.info('The catalogue is empty.')
        return
      }
      log.info('Apps you can install (Hobby and Pro):')
      for (const line of catalog_lines(catalog)) log.info(`  ${line}`)
      log.info(
        'Install one with: faable deploy install <app> --name <name> --input field=value …'
      )
      return
    }

    const bp = catalog.find(b => b.slug === args.app)
    if (!bp) {
      throw new CliError(
        'usage',
        `"${args.app}" is not in the catalogue. Available: ${catalog.map(b => b.slug).join(', ') || 'none'}.`
      )
    }
    const inputs = parse_inputs(args.input)
    const missing = missing_fields(bp, inputs)
    if (missing.length) {
      throw new CliError(
        'usage',
        `${bp.name} also needs: ${missing.map(f => `--input ${f.name}=… (${f.label})`).join(', ')}.`
      )
    }
    // The app is the site's container: named after its title unless asked.
    const name =
      args.name ??
      (inputs.title ? app_name_from_title(inputs.title) : undefined)
    if (!name) {
      throw new CliError(
        'usage',
        `Give the app a name: faable deploy install ${bp.slug} --name <name>.`
      )
    }
    const fqdn = args.domain?.trim().toLowerCase() || undefined
    const bad = fqdn ? domain_problem(fqdn) : null
    if (bad) throw new CliError('usage', bad)
    const { id: project } = await requireProject(api)
    let inst: FaableInstallation
    try {
      inst = await api.createInstallation(project, {
        blueprint: bp.slug,
        name,
        ...(args.tier ? { tier: args.tier } : {}),
        ...(fqdn ? { domain: fqdn } : {}),
        ...(Object.keys(inputs).length ? { inputs } : {})
      })
    } catch (err) {
      const e = err as Error & { code?: string }
      if (e.code === 'plan_required') {
        const failed = new CliError(
          'usage',
          `${bp.name} needs a Hobby or Pro project (it comes with a volume and a database). Upgrade it from the dashboard: project settings › Plan.`,
          { cause: err }
        )
        failed.code = 'plan_required'
        throw failed
      }
      throw err
    }
    log.info(`📦 Installing ${bp.name} as ${inst.name} (${inst.id})`)

    // The domain is created with the installation: its DNS is the user's, and
    // the site does not load on it until it points here (§548).
    const domain = inst.domain_id
      ? await api.getDomain(inst.domain_id, inst.team).catch(() => undefined)
      : undefined
    const dns = domain
      ? {
          fqdn: domain.fqdn,
          expected_cname: cname_target(domain),
          prevalidation_cname: acme_record(domain)
        }
      : undefined
    if (dns && !args.json) {
      log.info(``)
      log.info(
        `🌐 The site lives on ${dns.fqdn}. Configure its DNS — until it points at Faable, the site does not load there:`
      )
      log.info(`  ${dns.fqdn} CNAME → ${dns.expected_cname}`)
      log.info(
        `  A bare domain (example.com) takes an ALIAS instead, where your provider has it: https://faable.com/docs/deploy/domains/apex`
      )
      log.info(
        `  Optional, to issue its certificate first: ${dns.prevalidation_cname.name} CNAME → ${dns.prevalidation_cname.target}`
      )
      log.info(`Track it with: faable deploy domains check ${dns.fqdn}`)
      log.info(``)
    }

    let waited: InstallWaitResult | undefined
    let url: string | undefined
    if (args.wait) {
      waited = await wait_for_installation(api, inst, {
        timeout_s: args.timeout ?? 900
      })
      if (waited.ok && dns) {
        // WordPress lives on the domain (its faable.link address redirects
        // there), which answers once its DNS is in place: nothing to probe.
        url = `https://${dns.fqdn}`
      } else if (waited.ok && inst.app_id) {
        url = await api
          .getApp(inst.app_id)
          .then(a => (a.url ? `https://${a.url}` : undefined))
          .catch(() => undefined)
      }
      // Ready on the platform is not yet a URL that answers: the edge takes
      // a minute or two to route a new app, and its "app not found" is
      // cached for 120 s — the URL right away would look broken (17-11,
      // wp-catalog-canary). Same check as a deploy's (reachable.ts, F9).
      if (waited.ok && url && !dns) {
        const timeout = reachable_timeout_ms()
        if (timeout > 0) waited.reachable = await wait_reachable(url, timeout)
      }
      if (!args.json) {
        log.info(
          waited.ok
            ? waited.reachable === false
              ? `✅ Ready${url ? `: ${url}` : ''} — the address may take another minute to answer`
              : dns
                ? `✅ Ready: ${url} — once its DNS points at Faable`
                : `✅ Ready${url ? `: ${url}` : ''}`
            : waited.done
              ? `❌ The installation failed: ${waited.error ?? 'see the dashboard'}`
              : `⏳ Still ${waited.state} after ${args.timeout}s — it goes on; check it in the dashboard`
        )
      }
    }

    if (args.json) {
      return print_json({
        installation: inst,
        ...(dns ? { dns } : {}),
        ...(waited ? { result: { ...waited, ...(url ? { url } : {}) } } : {})
      })
    }
    if (!args.wait) {
      log.info(
        `⏳ It takes a few minutes. Follow it in the dashboard (Deploy › Installations), or run again with --wait.`
      )
    }
  }
}

// `faable deploy install restore [installation]` (§550): the dashboard's
// Restore. A new app with the uninstalled one's files, a copy of its
// database, its Auth tenant and its own domain; on faable.link, a new
// address with its links moved. Without an installation, the list.
const restoreInstallation = async (args: InstallArgs) => {
  const { api } = await requireApi()
  const { id: project } = await requireProject(api)
  const list = await api.listInstallations(project)

  if (!args.installation) {
    const can = restorable(list)
    if (args.json) return print_json(can)
    if (!can.length) {
      log.info(
        'Nothing to restore: no uninstalled installation in this project.'
      )
      return
    }
    log.info(
      'Uninstalled, and restorable while their data is kept (30 days, if the database was not deleted with them):'
    )
    for (const line of restorable_lines(list)) log.info(`  ${line}`)
    log.info('Restore one with: faable deploy install restore <name> --wait')
    return
  }

  const found = find_restorable(list, args.installation)
  if ('problem' in found) throw new CliError('usage', found.problem)
  let inst: FaableInstallation
  try {
    inst = await api.restoreInstallation(found.inst.id, project)
  } catch (err) {
    const e = err as Error & { code?: string }
    if (e.code === 'plan_required') {
      const failed = new CliError(
        'usage',
        `Restoring it needs a Hobby or Pro project (it comes back with a volume and a database). Upgrade it from the dashboard: project settings › Plan.`,
        { cause: err }
      )
      failed.code = 'plan_required'
      throw failed
    }
    throw err
  }
  log.info(`♻️  Restoring ${inst.name} (${inst.id}) as a new app`)

  let waited: InstallWaitResult | undefined
  let url: string | undefined
  if (args.wait) {
    waited = await wait_for_installation(api, inst, {
      timeout_s: args.timeout ?? 900
    })
    if (waited.ok) {
      const now = await api.getInstallation(inst.id, project).catch(() => inst)
      url = now.site_url ?? undefined
      inst = now
    }
    if (!args.json) {
      log.info(
        waited.ok
          ? `✅ Restored${url ? `: ${url}` : ''}`
          : waited.done
            ? `❌ The restore failed: ${waited.error ?? 'see the dashboard'} — resume it from the dashboard (Deploy › Installations)`
            : `⏳ Still ${waited.state} after ${args.timeout}s — it goes on; check it in the dashboard`
      )
    }
  }
  if (args.json) {
    return print_json({
      installation: inst,
      ...(waited ? { result: { ...waited, ...(url ? { url } : {}) } } : {})
    })
  }
  if (!args.wait) {
    log.info(
      `⏳ Copying its database takes a few minutes. Follow it in the dashboard (Deploy › Installations), or run again with --wait.`
    )
  }
}
