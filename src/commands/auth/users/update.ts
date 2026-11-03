import { CommandModule } from 'yargs'
import { requireAuthAdmin, withAuthHints } from '../../../api/auth_admin'
import { confirm } from '../../../lib/interactive'
import { log } from '../../../log'
import { TenantArgs, json_option, tenant_options } from '../options'
import { print_json } from '../render'
import { resolve_user_credential, resolve_user_ref } from './resolve'

interface UserUpdateArgs extends TenantArgs {
  user: string
  email?: string
  name?: string
  emailVerified?: boolean
  profileOnly?: boolean
  connection?: string
  yes?: boolean
}

// Updates a user's profile (email, name, verified flag). The catch with the
// email: the password login matches the CREDENTIAL identifier, not the
// profile email — change one without the other and the login keeps failing on
// the old address. So `--email` moves the database credential identifier too,
// unless `--profile-only` is set. (If the connection logs in by username, use
// `auth credentials update` instead.)
export const users_update: CommandModule<unknown, UserUpdateArgs> = {
  command: 'update <user>',
  describe: "Update a user's profile (email, name, verified) and, with --email, their login identifier",
  builder: yargs =>
    json_option(tenant_options(yargs))
      .positional('user', {
        type: 'string',
        demandOption: true,
        description: 'User id (user_…) or email'
      })
      .option('email', {
        type: 'string',
        description: 'New email — also becomes the database login identifier (see --profile-only)'
      })
      .option('name', { type: 'string', description: 'Display name' })
      .option('email-verified', {
        type: 'boolean',
        description: 'Mark the email verified (true) or clear verification (false)'
      })
      .option('profile-only', {
        type: 'boolean',
        default: false,
        description: 'With --email, change only the profile email, not the login identifier'
      })
      .option('connection', {
        type: 'string',
        description: 'Database connection id or name, when the user has more than one credential'
      })
      .option('yes', {
        alias: 'y',
        type: 'boolean',
        default: false,
        description: 'Skip the confirmation prompt'
      })
      .example(
        '$0 auth users update ana@example.com --email ana@new.com',
        'Change the email and the login identifier together'
      )
      .showHelpOnFail(false) as any,
  handler: withAuthHints(async args => {
    const patch: Record<string, unknown> = {}
    if (args.email !== undefined) patch.email = args.email
    if (args.name !== undefined) patch.name = args.name
    if (args.emailVerified !== undefined) patch.email_verified = args.emailVerified
    if (Object.keys(patch).length === 0) {
      throw new Error('Nothing to update. Pass --email, --name or --email-verified.')
    }

    const api = await requireAuthAdmin(args)
    const user_id = await resolve_user_ref(api, args.user)

    const move_credential = args.email !== undefined && !args.profileOnly
    // Resolved before the prompt so the summary is honest; a user with no
    // database credential just updates the profile (nothing to move).
    const cred = move_credential
      ? await resolve_user_credential(api, user_id, args.connection).catch(() => undefined)
      : undefined

    const summary = [
      args.email !== undefined ? `email → ${args.email}` : null,
      args.name !== undefined ? `name → ${args.name}` : null,
      args.emailVerified !== undefined ? `email_verified → ${args.emailVerified}` : null,
      cred ? `login identifier → ${args.email}` : null
    ]
      .filter(Boolean)
      .join(', ')

    const go = await confirm({ message: `Update ${args.user} (${summary})?`, yes: args.yes })
    if (!go) {
      log.info('Cancelled.')
      return
    }

    const user = await api.userUpdate(user_id, patch)
    if (cred) await api.credentialsUpdate(cred.id, { email: args.email })

    if (args.json) {
      return print_json({ ...user, login_identifier_updated: cred ? args.email : null })
    }
    log.info(`✅ Updated ${user.id} (${user.email ?? '-'}).`)
    if (cred) log.info(`   Login identifier is now ${args.email}.`)
    else if (args.email !== undefined && args.profileOnly) {
      log.info('   Profile email changed; login identifier left as is (--profile-only).')
    }
  })
}
