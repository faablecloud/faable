import { CommandModule } from 'yargs'
import { requireAuthAdmin, withAuthHints } from '../../../api/auth_admin'
import { log } from '../../../log'
import { ListArgs, json_option, list_options, tenant_options } from '../options'
import { compose_query } from '../query'
import { fetch_items } from '../paging'
import { print_json, table_lines, truncate, when, yes_no } from '../render'

interface UsersListArgs extends ListArgs {
  q?: string
  suspended?: boolean
}

export const users_list: CommandModule<unknown, UsersListArgs> = {
  command: 'list',
  describe: 'List and filter users',
  builder: yargs =>
    json_option(list_options(tenant_options(yargs)))
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
    const { items, more } = await fetch_items(
      api.userList({ query, q: args.q, pageSize: args.limit }),
      args.all
    )

    if (args.json) return print_json(items)

    if (items.length === 0) {
      log.info('📭 No users match.')
      return
    }
    log.info(`👥 ${items.length} user(s):`)
    const rows = items.map(u => [
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
      log.info(`  ${line}`)
    }
    if (more) {
      log.info('… more results available: raise --limit, use --all, or refine the filter.')
    }
  })
}
