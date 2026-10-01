import { CommandModule } from 'yargs'
import { requireAuthAdmin, withAuthHints } from '../../../api/auth_admin'
import { log } from '../../../log'
import { fetch_page, from_paginator, more_hint, print } from '../../../lib/listing'
import { AuthListArgs, list_options, tenant_options } from '../options'
import { print_json, table_lines, when, yes_no } from '../render'
import { formatTriggers } from './triggers'

export const actions_list: CommandModule<unknown, AuthListArgs> = {
  command: 'list',
  describe: 'List actions',
  builder: yargs =>
    list_options(tenant_options(yargs))
      .option('query', {
        type: 'string',
        description: 'FaableQL filter, e.g. "enabled:true"'
      })
      .showHelpOnFail(false) as any,
  handler: withAuthHints(async args => {
    const api = await requireAuthAdmin(args)
    const page = await fetch_page(
      from_paginator(api.actionList({ query: args.query })),
      args
    )

    if (args.json) return print_json(page)

    if (page.data.length === 0) {
      log.info('📭 No actions.')
      return
    }
    log.info(`⚙️ ${page.data.length} action(s):`)
    const rows = page.data.map(a => [
      a.id ?? '-',
      a.name ?? '-',
      formatTriggers(a as any),
      yes_no(a.enabled),
      String(a.order ?? 0),
      when(a.createdAt)
    ])
    for (const line of table_lines(
      ['ID', 'NAME', 'TRIGGER', 'ENABLED', 'ORDER', 'CREATED'],
      rows
    )) {
      print(line)
    }
    const hint = more_hint(page)
    if (hint) log.info(hint)
  })
}
