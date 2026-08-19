import prompts from 'prompts'
import { CommandModule } from 'yargs'
import { requireAuthAdmin, withAuthHints } from '../../../api/auth_admin'
import { log } from '../../../log'
import { TenantArgs, json_option, tenant_options } from '../options'
import { print_json } from '../render'
import { parse_user_ids, read_stdin, wants_stdin } from './ids'

interface ReinstateArgs extends TenantArgs {
  user_ids?: string[]
  yes?: boolean
}

export const users_reinstate: CommandModule<unknown, ReinstateArgs> = {
  command: 'reinstate [user_ids..]',
  describe: 'Reinstate one or more suspended users (re-enables logins and tokens)',
  builder: yargs =>
    json_option(tenant_options(yargs))
      .positional('user_ids', {
        type: 'string',
        array: true,
        description: 'User ids (user_…); omit them to read ids from stdin'
      })
      .option('yes', {
        alias: 'y',
        type: 'boolean',
        default: false,
        description: 'Skip the confirmation prompt'
      })
      .example('$0 auth users reinstate user_abc123', 'Reinstate one user')
      .example(
        'faable auth users list --suspended --json | jq -r ".[].id" | $0 auth users reinstate -y',
        'Bulk-reinstate ids piped from a filtered listing'
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
        message: `Reinstate ${ids.length} user(s) (${preview})?`,
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
        const user = await api.userUpdate(id, { suspended: false })
        results.push({ id, suspended: !!user.suspended })
        // Progress lines stay off stdout in --json mode (machine-clean pipe).
        if (!args.json) {
          log.info(`🟢 Reinstated ${id}${user.email ? ` (${user.email})` : ''}`)
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        results.push({ id, suspended: true, error: message })
        if (!args.json) log.error(`❌ Failed to reinstate ${id}: ${message}`)
      }
    }

    if (args.json) print_json(results)

    const failed = results.filter(r => r.error)
    if (failed.length > 0) {
      throw new Error(
        `${failed.length} of ${ids.length} reinstatement(s) failed${args.json ? '' : ' — see errors above'}`
      )
    }
    if (!args.json) {
      log.info(`✅ ${ids.length} user(s) reinstated.`)
    }
  })
}
