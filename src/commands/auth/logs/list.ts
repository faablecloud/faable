import { CommandModule } from 'yargs'
import { requireAuthAdmin, withAuthHints } from '../../../api/auth_admin'
import { log } from '../../../log'
import { fetch_page, from_paginator, more_hint, print } from '../../../lib/listing'
import { AuthListArgs, list_options, tenant_options } from '../options'
import { compose_query, range_term, term } from '../query'
import { resolve_user_ref } from '../users/resolve'
import { log_status_badge, print_json, table_lines, truncate } from '../render'

interface LogsListArgs extends AuthListArgs {
  q?: string
  type?: string
  status?: string
  origin?: string
  user?: string
  email?: string
  expandUser?: boolean
  client?: string
  since?: string
  until?: string
}

export const logs_list: CommandModule<unknown, LogsListArgs> = {
  command: 'list',
  describe: 'List and filter audit logs',
  builder: yargs =>
    list_options(tenant_options(yargs))
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
      .option('email', {
        type: 'string',
        description: "Filter by the subject user's email (exactly one user)"
      })
      .option('expand-user', {
        type: 'boolean',
        description: 'Embed each entry\'s user (email, name) instead of only its id'
      })
      .option('client', {
        type: 'string',
        description: 'Filter by subject client id'
      })
      .option('since', {
        type: 'string',
        description: 'From: a relative age (30m, 24h, 7d), unix-millis or YYYY-MM-DD'
      })
      .option('until', {
        type: 'string',
        description: 'To: a relative age (30m, 24h, 7d), unix-millis or YYYY-MM-DD'
      })
      .example(
        '$0 auth logs list --user user_abc123 --since 2026-08-01',
        "One user's audit trail since August 1st"
      )
      .example(
        '$0 auth logs list --origin oauth --status failed',
        'Failed OAuth events'
      )
      .example(
        '$0 auth logs list --type user.login --since 24h --expand-user',
        'Who logged in in the last 24 hours'
      )
      .showHelpOnFail(false) as any,
  handler: withAuthHints(async args => {
    const api = await requireAuthAdmin(args)
    const user = args.email
      ? await resolve_user_ref(api, args.email)
      : args.user
    const query = compose_query(
      [
        term('type', args.type),
        term('status', args.status),
        term('origin', args.origin),
        term('user', user),
        term('client', args.client),
        range_term('since', 'since', args.since),
        range_term('until', 'until', args.until)
      ],
      args.query
    )

    const page = await fetch_page(
      from_paginator(
        api.logList({
          query,
          q: args.q,
          ...(args.expandUser ? { expand: ['user'] } : {})
        })
      ),
      args
    )

    if (args.json) return print_json(page)

    if (page.data.length === 0) {
      log.info('📭 No audit log entries match.')
      return
    }
    log.info(`📜 ${page.data.length} entr${page.data.length === 1 ? 'y' : 'ies'}:`)
    const rows = page.data.map(entry => [
      entry.createdAt ?? '-',
      entry.type ?? '-',
      log_status_badge(entry.status),
      typeof entry.user === 'string'
        ? entry.user
        : ((entry.user as { email?: string; id?: string } | undefined)?.email ??
          (entry.user as { id?: string } | undefined)?.id ??
          '-'),
      truncate(entry.message, 48),
      entry.id ?? '-'
    ])
    for (const line of table_lines(
      ['DATE', 'TYPE', 'STATUS', 'USER', 'MESSAGE', 'ID'],
      rows
    )) {
      print(line)
    }
    const hint = more_hint(page)
    if (hint) log.info(hint)
  })
}
