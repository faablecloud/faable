import { CommandModule } from 'yargs'
import { requireAuthAdmin, withAuthHints } from '../../../api/auth_admin'
import { log } from '../../../log'
import { fetch_page, from_paginator, more_hint, print } from '../../../lib/listing'
import { AuthListArgs, list_options, tenant_options } from '../options'
import { compose_query, range_term, term } from '../query'
import { print_json, table_lines, truncate, when, yes_no } from '../render'
import { CliError } from '../../../lib/errors'

interface UsersListArgs extends AuthListArgs {
  q?: string
  email?: string
  suspended?: boolean
  sort?: string
  lastLoginSince?: string
  lastLoginUntil?: string
  createdSince?: string
  createdUntil?: string
  count?: boolean
}

// A Faable Auth older than ?count= / ?sort= / the date ranges answers 400
// "Unknown query parameter": say what is missing instead of passing that on.
const unsupported =
  (feature?: string) =>
  (e: unknown): never => {
    const res = (e as { response?: { status?: number; data?: any } })?.response
    const message = String(res?.data?.message ?? (e as Error)?.message ?? '')
    if (
      res?.status === 400 &&
      /Unknown query parameter|Unknown field|last_login_|created_(since|until)|sort/.test(
        message
      )
    ) {
      throw new CliError(
        'usage',
        `This Faable Auth does not support ${feature ?? 'that filter'} yet (${message}).`,
        { status: 400, cause: e }
      )
    }
    throw e
  }

export const USER_SORTS = [
  '-last_login',
  'last_login',
  '-logins_count',
  'logins_count',
  '-createdAt',
  'createdAt'
] as const

// The FaableQL filter of a users listing, from its flags.
export const users_query = (args: UsersListArgs, now?: number) =>
  compose_query(
    [
      args.suspended !== undefined && `suspended:${args.suspended}`,
      term('email', args.email?.toLowerCase()),
      range_term('last_login_since', 'last-login-since', args.lastLoginSince, now),
      range_term('last_login_until', 'last-login-until', args.lastLoginUntil, now),
      range_term('created_since', 'created-since', args.createdSince, now),
      range_term('created_until', 'created-until', args.createdUntil, now)
    ],
    args.query
  )

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
      .option('email', {
        type: 'string',
        description: 'Exact email'
      })
      .option('sort', {
        type: 'string',
        choices: USER_SORTS as unknown as string[],
        description:
          'Order: -last_login (most recent login first), last_login (longest absent first), -logins_count, -createdAt (default). Sorting by last_login leaves out users who never logged in'
      })
      .option('last-login-since', {
        type: 'string',
        description: 'Logged in at or after: 30m, 24h, 7d ago, unix-millis or YYYY-MM-DD'
      })
      .option('last-login-until', {
        type: 'string',
        description: 'Last login at or before (same formats)'
      })
      .option('created-since', {
        type: 'string',
        description: 'Signed up at or after (same formats)'
      })
      .option('created-until', {
        type: 'string',
        description: 'Signed up at or before (same formats)'
      })
      .option('count', {
        type: 'boolean',
        description:
          'Only count the users matching the filters ({"total": N}), across every page'
      })
      .example('$0 auth users list --suspended', 'List suspended users')
      .example(
        '$0 auth users list --sort -last_login --limit 20',
        'The 20 most recent logins'
      )
      .example(
        '$0 auth users list --last-login-since 24h --count',
        'How many users logged in in the last 24 hours'
      )
      .example(
        '$0 auth users list --query email_verified:false --limit 50',
        'First 50 unverified users'
      )
      .showHelpOnFail(false) as any,
  handler: withAuthHints(async args => {
    const api = await requireAuthAdmin(args)
    const query = users_query(args)

    if (args.count) {
      // One row is enough: the server counts the whole filter (`?count=true`).
      const res = await api.fetcher
        .get<{ total?: number }>('/user', {
          params: {
            pageSize: '1',
            count: 'true',
            ...(query ? { query } : {}),
            ...(args.q ? { q: args.q } : {})
          }
        })
        .catch(unsupported('count'))
      if (typeof res?.total !== 'number') {
        throw new Error(
          'This Faable Auth does not count users yet (no `total` in the answer).'
        )
      }
      if (args.json) return print_json({ total: res.total, query: query ?? null })
      print(String(res.total))
      return
    }

    const page = await fetch_page(
      p =>
        from_paginator(
          api.userList({
          query,
          q: args.q,
            ...(args.sort ? { sort: args.sort } : {})
          } as never)
        )(p).catch(unsupported(args.sort ? 'sort' : undefined)),
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
