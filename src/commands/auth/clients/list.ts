import { CommandModule } from 'yargs'
import { requireAuthAdmin, withAuthHints } from '../../../api/auth_admin'
import { log } from '../../../log'
import { fetch_page, from_paginator, more_hint, print } from '../../../lib/listing'
import { AuthListArgs, list_options, tenant_options } from '../options'
import { print_json, table_lines, truncate, when } from '../render'

interface ClientsListArgs extends AuthListArgs {
  q?: string
}

export const clients_list: CommandModule<unknown, ClientsListArgs> = {
  command: 'list',
  describe: 'List OAuth clients',
  builder: yargs =>
    list_options(tenant_options(yargs))
      .option('q', {
        type: 'string',
        description: 'Full-text search over name/description/client_id'
      })
      .showHelpOnFail(false) as any,
  handler: withAuthHints(async args => {
    const api = await requireAuthAdmin(args)
    const page = await fetch_page(
      from_paginator(api.clientList({ q: args.q })),
      args
    )

    if (args.json) return print_json(page)

    if (page.data.length === 0) {
      log.info('📭 No clients.')
      return
    }
    log.info(`🔑 ${page.data.length} client(s):`)
    const rows = page.data.map(c => [
      c.client_id ?? '-',
      truncate(c.name, 28),
      String(c.callbacks?.length ?? 0),
      when(c.createdAt)
    ])
    for (const line of table_lines(
      ['CLIENT_ID', 'NAME', 'CALLBACKS', 'CREATED'],
      rows
    )) {
      print(line)
    }
    const hint = more_hint(page)
    if (hint) log.info(hint)
  })
}
