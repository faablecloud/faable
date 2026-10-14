import { CommandModule } from 'yargs'
import { requireAuthAdmin, withAuthHints } from '../../../api/auth_admin'
import { log } from '../../../log'
import { TenantArgs, json_option, tenant_options } from '../options'
import { print_json } from '../render'
import { SECRET_WARNING } from './shared'

interface WebhooksRotateArgs extends TenantArgs {
  webhook_id: string
  secret?: string
}

export const webhooks_rotate_secret: CommandModule<
  unknown,
  WebhooksRotateArgs
> = {
  command: 'rotate-secret <webhook_id>',
  describe: "Rotate a webhook's signing secret (the old one stays valid 24 h)",
  builder: yargs =>
    json_option(tenant_options(yargs))
      .positional('webhook_id', {
        type: 'string',
        demandOption: true,
        description: 'Webhook id (notificationsubscription_…)'
      })
      .option('secret', {
        type: 'string',
        description: 'Use this secret instead of a generated one'
      })
      .showHelpOnFail(false) as any,
  handler: withAuthHints(async args => {
    const api = await requireAuthAdmin(args)
    const r = (await api.notificationsubscriptionRotateSecret(
      args.webhook_id,
      (args.secret ? { secret: args.secret } : {}) as any
    )) as any
    if (args.json) return print_json(r)
    log.info(`🔑 New signing secret: ${r.secret}`)
    log.info(`  ${SECRET_WARNING}`)
    log.info(
      `  Until ${r.previous_secret_expires_at} deliveries carry both signatures, so the receiver can switch over without dropping any.`
    )
  })
}
