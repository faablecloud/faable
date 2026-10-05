import { CommandModule } from 'yargs'
import { requireAuthAdmin, withAuthHints } from '../../../api/auth_admin'
import { CliError } from '../../../lib/errors'
import { confirm } from '../../../lib/interactive'
import { fetch_page, print_noop } from '../../../lib/listing'
import { log } from '../../../log'
import { TenantArgs, json_option, tenant_options } from '../options'
import { print_json } from '../render'
import { resolve_user_ref } from '../users/resolve'

interface SessionsRevokeArgs extends TenantArgs {
  session_ids?: string[]
  user?: string
  yes?: boolean
}

// Ends sessions: the cookie and every refresh token issued through each one
// stop working. Access tokens already issued live until they expire. Either
// explicit ids, or --user for every ACTIVE session of one user ("sign them out
// everywhere").
export const sessions_revoke: CommandModule<unknown, SessionsRevokeArgs> = {
  command: 'revoke [session_ids..]',
  describe: 'Revoke sessions (sign a user out of their devices)',
  builder: yargs =>
    json_option(tenant_options(yargs))
      .positional('session_ids', {
        type: 'string',
        array: true,
        description: 'Session ids (session_…)'
      })
      .option('user', {
        type: 'string',
        description: 'Every active session of this user: id (user_…) or email'
      })
      .option('yes', {
        alias: 'y',
        type: 'boolean',
        default: false,
        description: 'Skip the confirmation prompt'
      })
      .example('$0 auth sessions revoke --user ana@example.com -y', 'Sign Ana out everywhere')
      .showHelpOnFail(false) as any,
  handler: withAuthHints(async args => {
    const given = args.session_ids ?? []
    if (given.length > 0 === !!args.user) {
      throw new CliError('usage', 'Pass session ids, or --user — one of the two.')
    }
    // Explicit ids: the prompt comes before any request. --user has to look
    // the sessions up first (reads only), so that what is confirmed is what
    // runs.
    let api = args.user ? await requireAuthAdmin(args) : undefined

    let ids = given
    let who = ''
    if (args.user && api) {
      const user = await resolve_user_ref(api, args.user)
      who = ` of ${args.user}`
      const page = await fetch_page(
        ({ pageSize, next }) =>
          api.fetcher.get<{ results: Array<{ id: string }>; next?: string | null }>(
            '/session',
            {
              params: {
                pageSize: String(pageSize),
                ...(next ? { next } : {}),
                query: `user:${user} status:active`
              }
            }
          ),
        { limit: 200, all: true }
      )
      ids = page.data.map(s => s.id)
      if (ids.length === 0) {
        return print_noop(`${args.user} has no active sessions`)
      }
    }

    const go = await confirm({
      message: `Revoke ${ids.length} session(s)${who}?`,
      yes: args.yes
    })
    if (!go) {
      log.info('Cancelled.')
      return
    }

    api ??= await requireAuthAdmin(args)
    const results: Array<{ id: string; revoked: boolean; error?: string }> = []
    for (const id of ids) {
      try {
        await api.fetcher.post(`/session/${id}/revoke`, {})
        results.push({ id, revoked: true })
        if (!args.json) log.info(`🔒 Revoked ${id}`)
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        results.push({ id, revoked: false, error: message })
        if (!args.json) log.error(`❌ Failed to revoke ${id}: ${message}`)
      }
    }
    if (args.json) print_json(results)
    const failed = results.filter(r => r.error)
    if (failed.length > 0) {
      throw new Error(`${failed.length} of ${ids.length} revocation(s) failed`)
    }
    if (!args.json) {
      log.info(
        `✅ ${ids.length} session(s) revoked. Access tokens already issued stay valid until they expire.`
      )
    }
  })
}
