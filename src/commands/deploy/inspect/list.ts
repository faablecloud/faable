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

export const apps_list: CommandModule<unknown, ListArgs & { latest?: boolean }> = {
  command: 'list',
  describe: 'List the apps of the active project',
  builder: yargs =>
    list_options(yargs)
      .option('latest', {
        type: 'boolean',
        default: false,
        description:
          "Also each app's newest deployment, serving or not (`latest_deployment` with --json): which apps' last deploy failed, in one call"
      })
      .example(
        "$0 deploy apps list --latest --json | jq -r '.data[] | select(.latest_deployment.status.phase == \"BUILD_ERROR\") | .name'",
        'The apps whose last deploy failed to build'
      )
      .showHelpOnFail(false) as any,
  handler: async args => {
    const ctx = await requireApi()
    // Scoped to the active project when there is one (--project,
    // FAABLE_PROJECT, `faable project use`); every app you can see otherwise —
    // which the api only allows a token with a global scope. Anyone else gets
    // `team_or_scope_required`: then, like `whoami`, the only project they
    // belong to, or an error that says how to pick one (backlog §374).
    const list = () =>
      fetch_page(
        p => ctx.api.listApps(p, undefined, { latest: args.latest }),
        args
      )
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
      // The newest deployment, when asked for and when it is not what serves:
      // a failed build behind a live older version.
      const latest = app.latest_deployment
      const last =
        args.latest && latest
          ? latest.id === app.status?.deployment
            ? '  last deploy: live'
            : `  last deploy: ${latest.status?.phase ?? '?'} (${latest.id})`
          : args.latest
            ? '  last deploy: none'
            : ''
      print(
        `  ${app.name.padEnd(width)}  ${phase_badge(app.status?.phase)}  ${app.id}  https://${app.url}${last}`
      )
    }
    const hint = more_hint(page)
    if (hint) log.info(hint)
  }
}
