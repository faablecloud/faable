import { CommandModule } from 'yargs'
import { requireApi } from '../../../api/context'
import { requireProject } from '../../../api/project'
import {
  ListArgs,
  fetch_page,
  list_options,
  more_hint,
  print,
  print_json
} from '../../../lib/listing'
import { log } from '../../../log'
import { phase_badge } from './format'

export const apps_list: CommandModule<unknown, ListArgs> = {
  command: 'list',
  describe: 'List the apps of the active project',
  builder: yargs => list_options(yargs).showHelpOnFail(false) as any,
  handler: async args => {
    const ctx = await requireApi()
    // Scoped to the active project when there is one (--project,
    // FAABLE_PROJECT, `faable project use`); every app you can see otherwise —
    // which the api only allows a token with a global scope. Anyone else gets
    // `team_or_scope_required`: then, like `whoami`, the only project they
    // belong to, or an error that says how to pick one (backlog §374).
    const list = () => fetch_page(p => ctx.api.listApps(p), args)
    let page: Awaited<ReturnType<typeof list>>
    try {
      page = await list()
    } catch (e: any) {
      if (ctx.api.project || e?.code !== 'team_or_scope_required') throw e
      ctx.api.project = (await requireProject(ctx.api)).id
      page = await list()
    }
    if (args.json) return print_json(page)

    if (page.data.length === 0) {
      log.info(
        `📭 No apps yet. Create one in the dashboard (https://dashboard.faable.com) and link your repo.`
      )
      return
    }

    const scope = ctx.api.project ? ` in ${ctx.api.project}` : ''
    log.info(`📦 ${page.data.length} app(s)${scope}:`)
    const width = Math.max(...page.data.map(a => a.name.length))
    for (const app of page.data) {
      print(
        `  ${app.name.padEnd(width)}  ${phase_badge(app.status?.phase)}  ${app.id}  https://${app.url}`
      )
    }
    const hint = more_hint(page)
    if (hint) log.info(hint)
  }
}
