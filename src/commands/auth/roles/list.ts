import { CommandModule } from 'yargs'
import { requireAuthAdmin, withAuthHints } from '../../../api/auth_admin'
import {
  fetch_page,
  from_paginator,
  more_hint,
  print
} from '../../../lib/listing'
import { log } from '../../../log'
import { AuthListArgs, list_options, tenant_options } from '../options'
import { print_json, table_lines, truncate } from '../render'
import { RoleRow } from './shared'

export const roles_list: CommandModule<unknown, AuthListArgs> = {
  command: 'list',
  describe: 'List roles',
  builder: yargs =>
    list_options(tenant_options(yargs)).showHelpOnFail(false) as any,
  handler: withAuthHints(async args => {
    const api = await requireAuthAdmin(args)
    const page = await fetch_page(from_paginator(api.roleList({})), args)
    const data = page.data as RoleRow[]
    if (args.json) return print_json(page)

    if (data.length === 0) {
      log.info(
        '📭 No roles. Create one with `faable auth roles create <name>`.'
      )
      return
    }
    log.info(`🎭 ${data.length} role(s):`)
    const rows = data.map(r => [
      r.id,
      r.name,
      String(r.permissions?.length ?? 0),
      truncate(r.description, 50) || '-'
    ])
    for (const line of table_lines(
      ['ID', 'NAME', 'PERMISSIONS', 'DESCRIPTION'],
      rows
    )) {
      print(line)
    }
    const hint = more_hint(page)
    if (hint) log.info(hint)
  })
}
