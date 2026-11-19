import { CommandModule } from 'yargs'
import { requireAuthAdmin, withAuthHints } from '../../../api/auth_admin'
import { log } from '../../../log'
import { TenantArgs, json_option, tenant_options } from '../options'
import { print_json } from '../render'
import { EMAIL_EVENTS, assertEmailEvents, assertRecipients } from './shared'

interface EmailSubscriptionsCreateArgs extends TenantArgs {
  to: string[]
  event: string[]
  disabled?: boolean
}

export const email_subscriptions_create: CommandModule<
  unknown,
  EmailSubscriptionsCreateArgs
> = {
  command: 'create',
  describe: 'Email these addresses on tenant events (e.g. a new user)',
  builder: yargs =>
    json_option(tenant_options(yargs))
      .option('to', {
        type: 'string',
        array: true,
        demandOption: true,
        description: 'Recipient email address — repeatable'
      })
      .option('event', {
        alias: 'e',
        type: 'string',
        array: true,
        demandOption: true,
        description: `Event to email about — repeatable. One of: ${EMAIL_EVENTS.join(', ')}`
      })
      .option('disabled', {
        type: 'boolean',
        default: false,
        description: 'Create it inactive: nothing is sent until enabled'
      })
      .example(
        '$0 auth email-subscriptions create --to ops@example.com -e user.created -e user.updated',
        'Get an email (with the form fields) every time a user is created or updated'
      )
      .showHelpOnFail(false) as any,
  handler: withAuthHints(async args => {
    assertRecipients(args.to)
    assertEmailEvents(args.event)
    const api = await requireAuthAdmin(args)
    const created = (await api.notificationsubscriptionCreate({
      channel: 'email',
      events: args.event,
      active: !args.disabled,
      config: { recipients: args.to }
    } as any)) as any

    if (args.json) return print_json(created)

    log.info(`✅ Created email subscription ${created.id}`)
    log.info(`  To:     ${(created.config?.recipients ?? []).join(', ')}`)
    log.info(`  Events: ${(created.events ?? []).join(', ')}`)
    log.info(`  Active: ${created.active ? 'yes' : 'no'}`)
  })
}
