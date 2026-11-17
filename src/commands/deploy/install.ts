import { CommandModule } from 'yargs'
import type { FaableInstallation } from '../../api/FaableApi'
import { requireApi } from '../../api/context'
import { requireProject } from '../../api/project'
import { CliError } from '../../lib/errors'
import { json_option, print_json } from '../../lib/listing'
import { log } from '../../log'
import { reachable_timeout_ms, wait_reachable } from './reachable'
import {
  InstallWaitResult,
  catalog_lines,
  missing_fields,
  parse_inputs,
  wait_for_installation
} from './install_lib'

interface InstallArgs {
  app?: string
  name?: string
  input?: string[]
  tier?: string
  wait?: boolean
  timeout?: number
  json?: boolean
}

// `faable deploy install wordpress` — the dashboard's «Install an app»:
// installs an app of the Faable catalogue in the project (its App, a Volume
// for its files and a Database with daily backups; Hobby and Pro). Without
// an app, lists the catalogue: what can be installed and what each asks for.
export const install: CommandModule<unknown, InstallArgs> = {
  command: 'install [app]',
  describe:
    'Install an app from the Faable catalogue (WordPress…); without one, list the catalogue',
  builder: yargs =>
    json_option(yargs)
      .positional('app', {
        type: 'string',
        description: 'Catalogue app to install (e.g. wordpress)'
      })
      .option('name', {
        alias: 'n',
        type: 'string',
        description: 'Name of the app it creates (lowercase, digits and dashes)'
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
        '$0 deploy install wordpress --name blog --input title="My blog" --input admin_email=me@example.com --wait',
        'Install WordPress as "blog" and wait until it is ready'
      )
      .showHelpOnFail(false) as any,
  handler: async args => {
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
    if (!args.name) {
      throw new CliError(
        'usage',
        `Give the app a name: faable deploy install ${bp.slug} --name <name>.`
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
    const { id: project } = await requireProject(api)
    let inst: FaableInstallation
    try {
      inst = await api.createInstallation(project, {
        blueprint: bp.slug,
        name: args.name,
        ...(args.tier ? { tier: args.tier } : {}),
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

    let waited: InstallWaitResult | undefined
    let url: string | undefined
    if (args.wait) {
      waited = await wait_for_installation(api, inst, {
        timeout_s: args.timeout ?? 900
      })
      if (waited.ok && inst.app_id) {
        url = await api
          .getApp(inst.app_id)
          .then(a => (a.url ? `https://${a.url}` : undefined))
          .catch(() => undefined)
      }
      // Ready on the platform is not yet a URL that answers: the edge takes
      // a minute or two to route a new app, and its "app not found" is
      // cached for 120 s — the URL right away would look broken (17-11,
      // wp-catalog-canary). Same check as a deploy's (reachable.ts, F9).
      if (waited.ok && url) {
        const timeout = reachable_timeout_ms()
        if (timeout > 0) waited.reachable = await wait_reachable(url, timeout)
      }
      if (!args.json) {
        log.info(
          waited.ok
            ? waited.reachable === false
              ? `✅ Ready${url ? `: ${url}` : ''} — the address may take another minute to answer`
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
