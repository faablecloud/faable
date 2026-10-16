import { CommandModule } from 'yargs'
import { requireApi } from '../../../api/context'
import { CliError } from '../../../lib/errors'
import { confirm } from '../../../lib/interactive'
import { json_option, print_json } from '../../../lib/listing'
import { log } from '../../../log'
import { resolve_app_ref } from '../resolve_app_id'

interface AppsRmArgs {
  app?: string
  yes?: boolean
  json?: boolean
}

// `faable deploy apps rm` — delete an app, as the dashboard's «Delete app»
// does (same endpoint: the api applies the same holds and records who
// deleted it, `GET /app/:id/deletion`). Before this, a stray app — the empty
// one a failed `deploy --create` used to leave — could only go from the
// dashboard (arch/deploy/cli-mcp-fallos-2026-10-16-plan.md, F5).
//
// The app is always named: deleting the one this checkout happens to be
// linked to is not something to infer.
export const apps_rm: CommandModule<unknown, AppsRmArgs> = {
  command: 'rm',
  describe: 'Delete an app: its deployments, domains and secrets go with it',
  builder: yargs =>
    json_option(yargs)
      .option('app', {
        alias: 'a',
        type: 'string',
        description: 'App id, name or slug (always explicit)'
      })
      .option('yes', {
        alias: 'y',
        type: 'boolean',
        default: false,
        description: 'Skip the confirmation prompt'
      })
      .example('$0 deploy apps rm --app app_a1b2c3', 'Delete after confirmation')
      .showHelpOnFail(false) as any,
  handler: async args => {
    if (!args.app) {
      throw new CliError(
        'app_required',
        'Say which app to delete: --app <id|name>. It is never taken from the current directory.'
      )
    }
    const { api } = await requireApi()
    const app = await api.getApp(await resolve_app_ref(api, args.app))

    const go = await confirm({
      message: `Delete ${app.name} (${app.id})? https://${app.url} stops being served, and its deployments, domains and secrets go with it.`,
      yes: args.yes
    })
    if (!go) {
      log.info('Cancelled.')
      return
    }

    await api.deleteApp(app.id, app.team)
    if (args.json) {
      return print_json({ deleted: true, id: app.id, name: app.name })
    }
    log.info(`🗑️ Deleted ${app.name} (${app.id}).`)
  }
}
