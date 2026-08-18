import { CommandModule } from 'yargs'
import { requireAuthAdmin, withAuthHints } from '../../../api/auth_admin'
import { log } from '../../../log'
import { ListArgs, json_option, list_options, tenant_options } from '../options'
import { fetch_items } from '../paging'
import { compose_query, term, time_term } from '../query'
import { log_status_badge, print_json, table_lines, truncate } from '../render'

interface LogsListArgs extends ListArgs {
  q?: string
  type?: string
  status?: string
  origin?: string
  user?: string
  client?: string
  since?: string
  until?: string
}

export const logs_list: CommandModule<unknown, LogsListArgs> = {
  command: 'list',
  describe: 'List and filter audit logs',
  builder: yargs =>
    json_option(list_options(tenant_options(yargs)))
      .option('query', {
        type: 'string',
        description: 'Raw FaableQL filter (combined with the flags below)'
      })
      .option('q', {
        type: 'string',
        description: 'Full-text search over the log message'
      })
      .option('type', {
        type: 'string',
        description: 'Exact event type, e.g. admin.user.updated'
      })
      .option('status', {
        type: 'string',
        choices: ['success', 'failed', 'skipped', 'info'],
        description: 'Event status'
      })
      .option('origin', {
        type: 'string',
        description: 'Subsystem prefix, e.g. oauth (matches oauth.*)'
      })
      .option('user', {
        type: 'string',
        description: 'Filter by subject user id'
      })
      .option('client', {
        type: 'string',
        description: 'Filter by subject client id'
      })
      .option('since', {
        type: 'string',
        description: 'From date: unix-millis or YYYY-MM-DD'
      })
      .option('until', {
        type: 'string',
        description: 'To date: unix-millis or YYYY-MM-DD'
      })
      .example(
        '$0 auth logs list --user user_abc123 --since 2026-08-01',
        "One user's audit trail since August 1st"
      )
      .example(
        '$0 auth logs list --origin oauth --status failed',
        'Failed OAuth events'
      )
      .showHelpOnFail(false) as any,
  handler: withAuthHints(async args => {
    const query = compose_query(
      [
        term('type', args.type),
        term('status', args.status),
        term('origin', args.origin),
        term('user', args.user),
        term('client', args.client),
        time_term('since', args.since),
        time_term('until', args.until)
      ],
      args.query
    )

    const api = await requireAuthAdmin(args)
    const { items, more } = await fetch_items(
      api.logList({ query, q: args.q, pageSize: args.limit }),
      args.all
    )

    if (args.json) return print_json(items)

    if (items.length === 0) {
      log.info('📭 No audit log entries match.')
      return
    }
    log.info(`📜 ${items.length} entr${items.length === 1 ? 'y' : 'ies'}:`)
    const rows = items.map(entry => [
      entry.createdAt ?? '-',
      entry.type ?? '-',
      log_status_badge(entry.status),
      typeof entry.user === 'string'
        ? entry.user
        : ((entry.user as { id?: string } | undefined)?.id ?? '-'),
      truncate(entry.message, 48),
      entry.id ?? '-'
    ])
    for (const line of table_lines(
      ['DATE', 'TYPE', 'STATUS', 'USER', 'MESSAGE', 'ID'],
      rows
    )) {
      log.info(`  ${line}`)
    }
    if (more) {
      log.info('… more results available: raise --limit, use --all, or narrow with --since/--type.')
    }
  })
}
