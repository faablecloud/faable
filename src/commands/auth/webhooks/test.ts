import { CommandModule } from 'yargs'
import { requireAuthAdmin, withAuthHints } from '../../../api/auth_admin'
import { log } from '../../../log'
import { TenantArgs, json_option, tenant_options } from '../options'
import { print_json } from '../render'

interface WebhooksTestArgs extends TenantArgs {
  webhook_id: string
}

export const webhooks_test: CommandModule<unknown, WebhooksTestArgs> = {
  command: 'test <webhook_id>',
  describe: 'Send a signed `ping` to a webhook and show what it answered',
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
    const r = (await api.notificationsubscriptionTest(args.webhook_id)) as any
    if (args.json) return print_json(r)
    const what = r.status ? `HTTP ${r.status}` : (r.error ?? 'no answer')
    if (r.ok) {
      log.info(`✅ The endpoint answered ${what} (event ${r.event_id}).`)
    } else {
      log.error(`❌ The endpoint answered ${what} (event ${r.event_id}).`)
      process.exitCode = 1
    }
  })
}
