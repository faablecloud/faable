import crypto from 'crypto'
import { CommandModule } from 'yargs'
import { requireAuthAdmin, withAuthHints } from '../../../api/auth_admin'
import { confirm } from '../../../lib/interactive'
import { read_stdin } from '../../../lib/stdin'
import { log } from '../../../log'
import { TenantArgs, json_option, tenant_options } from '../options'
import { print_json } from '../render'
import { resolve_user_credential, resolve_user_ref } from './resolve'

interface SetPasswordArgs extends TenantArgs {
  user: string
  password?: string
  generate?: boolean
  connection?: string
  yes?: boolean
}

// 24 url-safe characters from 18 random bytes — ample entropy and nothing a
// shell will mangle when the admin pastes it on.
const generate_password = (): string => crypto.randomBytes(18).toString('base64url')

// Sets a user's database password directly, to the given value. The link flow
// (`password-setup`) is the right tool when the person can receive the email;
// this is for when they cannot and an admin must hand them a working password.
// The value never travels in argv: it is read from stdin (or generated).
export const users_set_password: CommandModule<unknown, SetPasswordArgs> = {
  command: 'set-password <user>',
  describe: "Set a user's database password directly (overwrites the current one)",
  builder: yargs =>
    json_option(tenant_options(yargs))
      .positional('user', {
        type: 'string',
        demandOption: true,
        description: 'User id (user_…) or email'
      })
      .option('password', {
        type: 'string',
        description:
          'The new password. Prefer stdin (keeps it out of shell history) or --generate.'
      })
      .option('generate', {
        type: 'boolean',
        default: false,
        description: 'Generate a strong password and print it once'
      })
      .option('connection', {
        type: 'string',
        description:
          "Database connection id or name, when the user has more than one credential"
      })
      .option('yes', {
        alias: 'y',
        type: 'boolean',
        default: false,
        description: 'Skip the confirmation prompt'
      })
      .example(
        '$0 auth users set-password ana@example.com --generate',
        'Set a random password and print it once'
      )
      .example(
        'printf %s "s3cr3t" | $0 auth users set-password ana@example.com -y',
        'Set a password read from stdin (never in shell history)'
      )
      .showHelpOnFail(false) as any,
  handler: withAuthHints(async args => {
    if (args.password && args.generate) {
      throw new Error('Pass either a password (stdin/--password) or --generate, not both.')
    }
    // Resolve the password before any request, so a piped value is consumed
    // deterministically and nothing runs when there is none.
    let password = args.password
    if (args.generate) password = generate_password()
    if (!password && !process.stdin.isTTY) password = (await read_stdin()).trim()
    if (!password) {
      throw new Error(
        'No password given. Use --generate, or pipe the password on stdin.'
      )
    }

    const api = await requireAuthAdmin(args)
    const user_id = await resolve_user_ref(api, args.user)
    const cred = await resolve_user_credential(api, user_id, args.connection)
    const login = cred.email ?? cred.username ?? cred.id

    const go = await confirm({
      message: `Set a new password for ${args.user} (login ${login})?`,
      yes: args.yes
    })
    if (!go) {
      log.info('Cancelled.')
      return
    }

    await api.credentialsSetPassword(cred.id, { password })

    if (args.json) {
      return print_json({
        user_id,
        credential: cred.id,
        login,
        ...(args.generate ? { password } : {})
      })
    }
    log.info(`✅ Password set for ${args.user} (login ${login}).`)
    if (args.generate) log.info(`   Password (shown once): ${password}`)
    log.info('   They can change it from their profile once signed in.')
  })
}
