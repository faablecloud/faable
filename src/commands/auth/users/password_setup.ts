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
  print?: boolean
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
      .option('print', {
        type: 'boolean',
        default: false,
        description:
          'Also print the recovery link, to hand it over by another channel when the email will not reach the person (email channel only)'
      })
      .option('yes', {
        alias: 'y',
        type: 'boolean',
        default: false,
        description: 'Skip the confirmation prompt'
      })
      .example(
        '$0 auth users password-setup ana@example.com --print',
        'Mint a reset link and print it (also sends the email)'
      )
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
    const id = await resolve_user_ref(api, user_id)
    const res = await api.userPasswordSetup(id, {
      ...(args.channel ? { channel: args.channel } : {})
    })
    const channel = (res as { channel?: string }).channel ?? 'email'

    // The setup response carries only the ticket id; the usable link lives on
    // the ticket. Read it back when asked — the way to deliver a reset to
    // someone whose mailbox does not receive (a login identifier that is not a
    // real inbox). A link exists only for the email channel.
    let link: string | undefined
    if (args.print && channel === 'email') {
      const ticket_id = (res as { ticket_id?: string }).ticket_id
      const tickets = await api
        .userListTickets(id)
        .then(r => (r as { results?: Array<{ id: string; link?: string }> }).results ?? [])
        .catch(() => [])
      link = tickets.find(t => t.id === ticket_id)?.link ?? tickets.find(t => t.link)?.link
    }

    if (args.json) return print_json({ user_id: id, ...res, ...(link ? { link } : {}) })
    log.info(`📨 Sent to ${args.user} (${channel}).`)
    if (args.print) {
      if (link) log.info(`🔗 ${link}`)
      else if (channel === 'email')
        log.info('   (link not available — it may already be consumed or expired)')
      else log.info(`   (no link: the ${channel} channel delivers a code, not a link)`)
    }
  })
}
