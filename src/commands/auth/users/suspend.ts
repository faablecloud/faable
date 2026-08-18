import prompts from 'prompts'
import { CommandModule } from 'yargs'
import { requireAuthAdmin, withAuthHints } from '../../../api/auth_admin'
import { log } from '../../../log'
import { TenantArgs, json_option, tenant_options } from '../options'
import { print_json } from '../render'
import { parse_user_ids, read_stdin, wants_stdin } from './ids'

interface SuspendArgs extends TenantArgs {
  user_ids?: string[]
  reason?: string
  yes?: boolean
}

export const users_suspend: CommandModule<unknown, SuspendArgs> = {
  command: 'suspend [user_ids..]',
  describe: 'Suspend one or more users (blocks logins, refresh tokens and sessions)',
  builder: yargs =>
    json_option(tenant_options(yargs))
      .positional('user_ids', {
        type: 'string',
        array: true,
        description: 'User ids (user_…); omit them to read ids from stdin'
      })
      .option('reason', {
        alias: 'r',
        type: 'string',
        description: 'Suspension reason, recorded on the user (max 512 chars)'
      })
      .option('yes', {
        alias: 'y',
        type: 'boolean',
        default: false,
        description: 'Skip the confirmation prompt'
      })
      .example(
        '$0 auth users suspend user_abc123 --reason "abuse: proxy payload"',
        'Suspend one user'
      )
      .example(
        '$0 auth users suspend user_a user_b user_c -y -r "abuse wave"',
        'Suspend several users without prompting'
      )
      .example(
        'faable auth users list --query email_verified:false --json | jq -r ".[].id" | $0 auth users suspend -y',
        'Bulk-suspend ids piped from a filtered listing'
      )
      .showHelpOnFail(false) as any,
  handler: withAuthHints(async args => {
    const argv_ids = args.user_ids ?? []
    const stdin = wants_stdin(argv_ids, !!process.stdin.isTTY)
      ? await read_stdin()
      : null
    const ids = parse_user_ids(argv_ids, stdin)

    if (!args.yes) {
      const preview = ids.slice(0, 5).join(', ') + (ids.length > 5 ? ', …' : '')
      // In a non-TTY run without --yes, prompts resolves undefined → cancel.
      const { confirm } = await prompts({
        type: 'toggle',
        name: 'confirm',
        message: `Suspend ${ids.length} user(s) (${preview})?`,
        initial: false,
        active: 'yes',
        inactive: 'no'
      })
      if (!confirm) {
        log.info('Cancelled.')
        return
      }
    }

    const api = await requireAuthAdmin(args)
    const results: Array<{ id: string; suspended: boolean; error?: string }> = []
    for (const id of ids) {
      try {
        const user = await api.userUpdate(id, {
          suspended: true,
          ...(args.reason ? { suspended_reason: args.reason } : {})
        })
        results.push({ id, suspended: !!user.suspended })
        // Progress lines stay off stdout in --json mode (machine-clean pipe).
        if (!args.json) {
          log.info(`🔴 Suspended ${id}${user.email ? ` (${user.email})` : ''}`)
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        results.push({ id, suspended: false, error: message })
        if (!args.json) log.error(`❌ Failed to suspend ${id}: ${message}`)
      }
    }

    if (args.json) print_json(results)

    const failed = results.filter(r => r.error)
    if (failed.length > 0) {
      throw new Error(
        `${failed.length} of ${ids.length} suspension(s) failed${args.json ? '' : ' — see errors above'}`
      )
    }
    if (!args.json) {
      log.info(
        `✅ ${ids.length} user(s) suspended. Live access tokens against external APIs remain valid until expiry (≤24h).`
      )
    }
  })
}
