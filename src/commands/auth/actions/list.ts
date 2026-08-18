import { CommandModule } from 'yargs'
import { requireAuthAdmin, withAuthHints } from '../../../api/auth_admin'
import { log } from '../../../log'
import { ListArgs, json_option, list_options, tenant_options } from '../options'
import { fetch_items } from '../paging'
import { print_json, table_lines, when, yes_no } from '../render'

export const actions_list: CommandModule<unknown, ListArgs> = {
  command: 'list',
  describe: 'List actions',
  builder: yargs =>
    json_option(list_options(tenant_options(yargs)))
      .option('query', {
        type: 'string',
        description: 'FaableQL filter, e.g. "trigger:post-login"'
      })
      .showHelpOnFail(false) as any,
  handler: withAuthHints(async args => {
    const api = await requireAuthAdmin(args)
    const { items, more } = await fetch_items(
      api.actionList({ query: args.query, pageSize: args.limit }),
      args.all
    )

    if (args.json) return print_json(items)

    if (items.length === 0) {
      log.info('📭 No actions.')
      return
    }
    log.info(`⚙️ ${items.length} action(s):`)
    const rows = items.map(a => [
      a.id ?? '-',
      a.name ?? '-',
      a.trigger ?? '-',
      yes_no(a.enabled),
      String(a.order ?? 0),
      when(a.createdAt)
    ])
    for (const line of table_lines(
      ['ID', 'NAME', 'TRIGGER', 'ENABLED', 'ORDER', 'CREATED'],
      rows
    )) {
      log.info(`  ${line}`)
    }
    if (more) {
      log.info('… more results available: raise --limit or use --all.')
    }
  })
}
