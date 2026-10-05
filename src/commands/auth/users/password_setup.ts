import { CommandModule } from 'yargs'
import { requireAuthAdmin, withAuthHints } from '../../../api/auth_admin'
import { confirm } from '../../../lib/interactive'
import { log } from '../../../log'
import { TenantArgs, json_option, tenant_options } from '../options'
import { print_json } from '../render'
import { resolve_user_ref } from './resolve'

interface PasswordSetupArgs extends TenantArgs {
  user: string
  channel?: 'email' | 'sms' | 'whatsapp'
  yes?: boolean
}

// Sends the user a link (or a code) to set — or reset — their password. The
// way to "invite" a user created by hand, or to unblock one who forgot it.
export const users_password_setup: CommandModule<unknown, PasswordSetupArgs> = {
  command: 'password-setup <user>',
  describe: 'Send a user the email (or code) to set or reset their password',
  builder: yargs =>
    json_option(tenant_options(yargs))
      .positional('user', {
        type: 'string',
        demandOption: true,
        description: 'User id (user_…) or email'
      })
      .option('channel', {
        type: 'string',
        choices: ['email', 'sms', 'whatsapp'],
        description: "How to deliver it (default: the tenant's)"
      })
      .option('yes', {
        alias: 'y',
        type: 'boolean',
        default: false,
        description: 'Skip the confirmation prompt'
      })
      .showHelpOnFail(false) as any,
  handler: withAuthHints(async args => {
    // An email is resolved first (a read), so the prompt names one user; an
    // id is confirmed before any request.
    const early = args.user.includes('@') ? await requireAuthAdmin(args) : undefined
    const user_id = early ? await resolve_user_ref(early, args.user) : args.user
    const go = await confirm({
      message: `Send ${args.user} a password setup ${args.channel ?? 'message'}?`,
      yes: args.yes
    })
    if (!go) {
      log.info('Cancelled.')
      return
    }
    const api = early ?? (await requireAuthAdmin(args))
    const res = await api.userPasswordSetup(await resolve_user_ref(api, user_id), {
      ...(args.channel ? { channel: args.channel } : {})
    })
    if (args.json) return print_json({ user_id, ...res })
    log.info(`📨 Sent to ${args.user} (${(res as { channel?: string }).channel ?? 'email'}).`)
  })
}
