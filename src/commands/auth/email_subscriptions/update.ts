import { CommandModule } from 'yargs'
import { requireAuthAdmin, withAuthHints } from '../../../api/auth_admin'
import { log } from '../../../log'
import { TenantArgs, json_option, tenant_options } from '../options'
import { print_json, yes_no } from '../render'
import { assertEmailEvents, assertRecipients } from './shared'

interface EmailSubscriptionsUpdateArgs extends TenantArgs {
  subscription_id: string
  to?: string[]
  event?: string[]
  enabled?: boolean
}

export const email_subscriptions_update: CommandModule<
  unknown,
  EmailSubscriptionsUpdateArgs
> = {
  command: 'update <subscription_id>',
  describe: 'Change an email subscription (recipients, events, enabled)',
  builder: yargs =>
    json_option(tenant_options(yargs))
      .positional('subscription_id', {
        type: 'string',
        demandOption: true,
        description: 'Subscription id (notificationsubscription_…)'
      })
      .option('to', {
        type: 'string',
        array: true,
        description: 'Replace the recipients — repeatable'
      })
      .option('event', {
        alias: 'e',
        type: 'string',
        array: true,
        description: 'Replace the events — repeatable'
      })
      .option('enabled', {
        type: 'boolean',
        description: 'Enable (--enabled) or pause (--no-enabled) the emails'
      })
      .showHelpOnFail(false) as any,
  handler: withAuthHints(async args => {
    if (args.to?.length) assertRecipients(args.to)
    if (args.event?.length) assertEmailEvents(args.event)
    const patch = {
      ...(args.to?.length ? { config: { recipients: args.to } } : {}),
      ...(args.event?.length ? { events: args.event } : {}),
      ...(args.enabled !== undefined ? { active: args.enabled } : {})
    }
    if (Object.keys(patch).length === 0) {
      throw new Error(
        'Nothing to update — pass at least one of --to, --event, --enabled'
      )
    }
    const api = await requireAuthAdmin(args)
    const s = (await api.notificationsubscriptionUpdate(
      args.subscription_id,
      patch as any
    )) as any
    if (args.json) return print_json(s)
    log.info(
      `✅ Updated email subscription ${s.id} (${(s.config?.recipients ?? []).join(', ')}, ${(s.events ?? []).join(', ')}, active ${yes_no(s.active)})`
    )
  })
}
