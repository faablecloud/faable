import { CommandModule } from 'yargs'
import { requireAuthAdmin, withAuthHints } from '../../../api/auth_admin'
import { log } from '../../../log'
import { TenantArgs, json_option, tenant_options } from '../options'
import { print_json, when, yes_no } from '../render'
import { WebhookSubscription } from './shared'

interface WebhooksGetArgs extends TenantArgs {
  webhook_id: string
}

export const webhooks_get: CommandModule<unknown, WebhooksGetArgs> = {
  command: 'get <webhook_id>',
  describe: 'Show a webhook',
  builder: yargs =>
    json_option(tenant_options(yargs))
      .positional('webhook_id', {
        type: 'string',
        demandOption: true,
        description: 'Webhook id (notificationsubscription_…)'
      })
      .showHelpOnFail(false) as any,
  handler: withAuthHints(async args => {
    const api = await requireAuthAdmin(args)
    const w = (await api.notificationsubscriptionGet(
      args.webhook_id
    )) as unknown as WebhookSubscription
    if (args.json) return print_json(w)

    log.info(`🪝 ${w.id}`)
    log.info(`  URL:       ${w.config?.url ?? '-'}`)
    log.info(`  Events:    ${w.events.join(', ')}`)
    log.info(`  Active:    ${yes_no(w.active)}`)
    log.info(
      `  Status:    ${w.status ?? '-'}${w.consecutive_failures ? ` (${w.consecutive_failures} failures in a row)` : ''}`
    )
    log.info(`  Last OK:   ${when(w.last_success_at)}`)
    log.info(`  Last fail: ${when(w.last_failure_at)}`)
    if (w.config?.previous_secret_expires_at) {
      log.info(
        `  Previous secret valid until ${w.config.previous_secret_expires_at} (rotation overlap)`
      )
    }
  })
}
