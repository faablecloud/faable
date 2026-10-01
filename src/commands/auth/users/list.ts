import { CommandModule } from 'yargs'
import { requireAuthAdmin, withAuthHints } from '../../../api/auth_admin'
import { log } from '../../../log'
import { fetch_page, from_paginator, more_hint, print } from '../../../lib/listing'
import { AuthListArgs, list_options, tenant_options } from '../options'
import { compose_query } from '../query'
import { print_json, table_lines, truncate, when, yes_no } from '../render'

interface UsersListArgs extends AuthListArgs {
  q?: string
  suspended?: boolean
}

export const users_list: CommandModule<unknown, UsersListArgs> = {
  command: 'list',
  describe: 'List and filter users',
  builder: yargs =>
    list_options(tenant_options(yargs))
      .option('query', {
        type: 'string',
        description:
          'FaableQL filter, e.g. "suspended:true email_verified:false" (fields: email, name, phone, suspended, email_verified, country_iso, locale, last_ip)'
      })
      .option('q', {
        type: 'string',
        description: 'Full-text search over name/email/phone'
      })
      .option('suspended', {
        type: 'boolean',
        description: 'Only suspended users (shorthand for query suspended:true)'
      })
      .example('$0 auth users list --suspended', 'List suspended users')
      .example(
        '$0 auth users list --query email_verified:false --limit 50',
        'First 50 unverified users'
      )
      .showHelpOnFail(false) as any,
  handler: withAuthHints(async args => {
    const api = await requireAuthAdmin(args)
    const query = compose_query(
      [args.suspended !== undefined && `suspended:${args.suspended}`],
      args.query
    )
    const page = await fetch_page(
      from_paginator(api.userList({ query, q: args.q })),
      args
    )

    if (args.json) return print_json(page)

    if (page.data.length === 0) {
      log.info('📭 No users match.')
      return
    }
    log.info(`👥 ${page.data.length} user(s):`)
    const rows = page.data.map(u => [
      u.id ?? '-',
      truncate(u.email, 32),
      truncate(u.name, 24),
      yes_no(u.email_verified),
      u.suspended ? '🔴 suspended' : '-',
      when(u.last_login)
    ])
    for (const line of table_lines(
      ['ID', 'EMAIL', 'NAME', 'VERIFIED', 'SUSPENDED', 'LAST LOGIN'],
      rows
    )) {
      print(line)
    }
    const hint = more_hint(page)
    if (hint) log.info(hint)
  })
}
