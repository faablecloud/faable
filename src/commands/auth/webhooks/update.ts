import { CommandModule } from 'yargs'
import { requireAuthAdmin, withAuthHints } from '../../../api/auth_admin'
import { log } from '../../../log'
import { TenantArgs, json_option, tenant_options } from '../options'
import { print_json, yes_no } from '../render'

interface WebhooksUpdateArgs extends TenantArgs {
  webhook_id: string
  url?: string
  event?: string[]
  enabled?: boolean
}

export const webhooks_update: CommandModule<unknown, WebhooksUpdateArgs> = {
  command: 'update <webhook_id>',
  describe: 'Change a webhook (URL, events, enabled)',
  builder: yargs =>
    json_option(tenant_options(yargs))
      .positional('webhook_id', {
        type: 'string',
        demandOption: true,
        description: 'Webhook id (notificationsubscription_…)'
      })
      .option('url', { type: 'string', description: 'New https URL' })
      .option('event', {
        alias: 'e',
        type: 'string',
        array: true,
        description: 'Replace the subscribed events — repeatable'
      })
      .option('enabled', {
        type: 'boolean',
        description: 'Enable (--enabled) or pause (--no-enabled) deliveries'
      })
      .example(
        '$0 auth webhooks update notificationsubscription_… --no-enabled',
        'Pause deliveries'
      )
      .showHelpOnFail(false) as any,
  handler: withAuthHints(async args => {
    const patch = {
      ...(args.url !== undefined ? { config: { url: args.url } } : {}),
      ...(args.event?.length ? { events: args.event } : {}),
      ...(args.enabled !== undefined ? { active: args.enabled } : {})
    }
    if (Object.keys(patch).length === 0) {
      throw new Error(
        'Nothing to update — pass at least one of --url, --event, --enabled'
      )
    }
    const api = await requireAuthAdmin(args)
    const w = (await api.notificationsubscriptionUpdate(
      args.webhook_id,
      patch as any
    )) as any
    if (args.json) return print_json(w)
    log.info(
      `✅ Updated webhook ${w.id} (${w.config?.url}, ${(w.events ?? []).join(', ')}, active ${yes_no(w.active)})`
    )
  })
}
