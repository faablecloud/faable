import { CommandModule } from 'yargs'
import { requireAuthAdmin, withAuthHints } from '../../../api/auth_admin'
import { log } from '../../../log'
import { ListArgs, json_option, list_options, tenant_options } from '../options'
import { fetch_items } from '../paging'
import { print_json, table_lines, truncate, when } from '../render'

interface ClientsListArgs extends ListArgs {
  q?: string
}

export const clients_list: CommandModule<unknown, ClientsListArgs> = {
  command: 'list',
  describe: 'List OAuth clients',
  builder: yargs =>
    json_option(list_options(tenant_options(yargs)))
      .option('q', {
        type: 'string',
        description: 'Full-text search over name/description/client_id'
      })
      .showHelpOnFail(false) as any,
  handler: withAuthHints(async args => {
    const api = await requireAuthAdmin(args)
    const { items, more } = await fetch_items(
      api.clientList({ q: args.q, pageSize: args.limit }),
      args.all
    )

    if (args.json) return print_json(items)

    if (items.length === 0) {
      log.info('📭 No clients.')
      return
    }
    log.info(`🔑 ${items.length} client(s):`)
    const rows = items.map(c => [
      c.client_id ?? '-',
      truncate(c.name, 28),
      String(c.callbacks?.length ?? 0),
      when(c.createdAt)
    ])
    for (const line of table_lines(
      ['CLIENT_ID', 'NAME', 'CALLBACKS', 'CREATED'],
      rows
    )) {
      log.info(`  ${line}`)
    }
    if (more) {
      log.info('… more results available: raise --limit or use --all.')
    }
  })
}
