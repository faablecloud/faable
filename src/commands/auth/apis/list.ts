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
import { print_json, table_lines, yes_no } from '../render'
import { ApiRow } from '../roles/shared'

export const apis_list: CommandModule<unknown, AuthListArgs> = {
  command: 'list',
  describe: 'List APIs (resource servers)',
  builder: yargs =>
    list_options(tenant_options(yargs)).showHelpOnFail(false) as any,
  handler: withAuthHints(async args => {
    const api = await requireAuthAdmin(args)
    const page = await fetch_page(from_paginator(api.apiList({})), args)
    const data = page.data as ApiRow[]
    if (args.json) return print_json(page)
    log.info(`🔌 ${data.length} API(s):`)
    const rows = data.map(a => [
      a.id,
      a.name,
      a.identifier,
      a.token_dialect ?? '-',
      yes_no(a.rbac),
      String(a.permissions?.length ?? 0)
    ])
    for (const line of table_lines(
      ['ID', 'NAME', 'IDENTIFIER', 'DIALECT', 'RBAC', 'PERMISSIONS'],
      rows
    )) {
      print(line)
    }
    const hint = more_hint(page)
    if (hint) log.info(hint)
  })
}
