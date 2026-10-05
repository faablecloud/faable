import { CommandModule } from 'yargs'
import { requireAuthAdmin, withAuthHints } from '../../../api/auth_admin'
import { log } from '../../../log'
import { fetch_page, from_paginator, more_hint, print } from '../../../lib/listing'
import { AuthListArgs, list_options, tenant_options } from '../options'
import { print_json, table_lines, yes_no } from '../render'

interface ConnectionsListArgs extends AuthListArgs {
  enabled?: boolean
}

// The tenant's login methods: social providers (Google, GitHub…),
// passwordless (email/SMS codes) and username-password databases.
export const connections_list: CommandModule<unknown, ConnectionsListArgs> = {
  command: 'list',
  describe: 'List login methods (social, passwordless, database)',
  builder: yargs =>
    list_options(tenant_options(yargs))
      .option('enabled', {
        type: 'boolean',
        description: 'Only enabled (or, with --no-enabled, disabled) connections'
      })
      .showHelpOnFail(false) as any,
  handler: withAuthHints(async args => {
    const api = await requireAuthAdmin(args)
    const page = await fetch_page(
      from_paginator(
        api.connectionList({
          ...(args.enabled !== undefined ? { enabled: String(args.enabled) } : {})
        } as never)
      ),
      args
    )
    // Never the provider secrets: name, type and whether it is on.
    const data = page.data.map((c: any) => ({
      id: c.id,
      connection_name: c.connection_name,
      connection_type: c.connection_type,
      enabled: !!c.enabled,
      enabled_clients: Array.isArray(c.enabled_clients)
        ? c.enabled_clients.length
        : undefined
    }))

    if (args.json) return print_json({ ...page, data })
    if (data.length === 0) {
      log.info('📭 No connections.')
      return
    }
    for (const line of table_lines(
      ['ID', 'NAME', 'TYPE', 'ENABLED'],
      data.map(c => [c.id, c.connection_name ?? '-', c.connection_type ?? '-', yes_no(c.enabled)])
    )) {
      print(line)
    }
    const hint = more_hint(page)
    if (hint) log.info(hint)
  })
}
