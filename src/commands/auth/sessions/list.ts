import { CommandModule } from 'yargs'
import { requireAuthAdmin, withAuthHints } from '../../../api/auth_admin'
import { log } from '../../../log'
import { fetch_page, more_hint, print } from '../../../lib/listing'
import { AuthListArgs, list_options, tenant_options } from '../options'
import { compose_query, range_term, term } from '../query'
import { print_json, table_lines, truncate, when } from '../render'
import { resolve_user_ref } from '../users/resolve'

interface SessionsListArgs extends AuthListArgs {
  user?: string
  active?: boolean
  since?: string
}

// One row per authentication of a user (arch/auth/user-sessions-devices.md):
// the devices a user is signed in on, and from where. Not in the generated
// auth-sdk yet — called through its fetcher, as the dashboard does.
export const sessions_list: CommandModule<unknown, SessionsListArgs> = {
  command: 'list',
  describe: "List sessions (a user's signed-in devices)",
  builder: yargs =>
    list_options(tenant_options(yargs))
      .option('user', {
        type: 'string',
        description: 'Only this user: id (user_…) or email'
      })
      .option('active', {
        type: 'boolean',
        description: 'Only sessions still active (not revoked)'
      })
      .option('since', {
        type: 'string',
        description:
          'Seen at or after: a relative age (30m, 24h, 7d), unix-millis or YYYY-MM-DD'
      })
      .option('query', {
        type: 'string',
        description: 'Raw FaableQL filter (fields: user, client, connection, status, sid, since, until)'
      })
      .example('$0 auth sessions list --user ana@example.com --active', "Ana's devices")
      .showHelpOnFail(false) as any,
  handler: withAuthHints(async args => {
    const api = await requireAuthAdmin(args)
    const user = args.user ? await resolve_user_ref(api, args.user) : undefined
    const query = compose_query(
      [
        term('user', user),
        args.active !== undefined && `status:${args.active ? 'active' : 'revoked'}`,
        range_term('since', 'since', args.since)
      ],
      args.query
    )
    const page = await fetch_page(
      ({ pageSize, next }) =>
        api.fetcher.get<{ results: any[]; next?: string | null }>('/session', {
          params: {
            pageSize: String(pageSize),
            ...(next ? { next } : {}),
            ...(query ? { query } : {})
          }
        }),
      args
    )

    if (args.json) return print_json(page)
    if (page.data.length === 0) {
      log.info('📭 No sessions match.')
      return
    }
    log.info(`💻 ${page.data.length} session(s):`)
    const rows = page.data.map((s: any) => [
      s.id ?? '-',
      typeof s.user === 'string' ? s.user : (s.user?.id ?? '-'),
      s.status ?? '-',
      s.ip ?? '-',
      truncate(s.device_name ?? s.user_agent, 32),
      when(s.last_seen_at)
    ])
    for (const line of table_lines(
      ['ID', 'USER', 'STATUS', 'IP', 'DEVICE', 'LAST SEEN'],
      rows
    )) {
      print(line)
    }
    const hint = more_hint(page)
    if (hint) log.info(hint)
  })
}
