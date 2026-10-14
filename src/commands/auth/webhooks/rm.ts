import { CommandModule } from 'yargs'
import { requireAuthAdmin, withAuthHints } from '../../../api/auth_admin'
import { confirm } from '../../../lib/interactive'
import { log } from '../../../log'
import { TenantArgs, json_option, tenant_options } from '../options'
import { print_json } from '../render'

interface WebhooksRmArgs extends TenantArgs {
  webhook_id: string
  yes?: boolean
}

export const webhooks_rm: CommandModule<unknown, WebhooksRmArgs> = {
  command: 'rm <webhook_id>',
  describe: 'Delete a webhook',
  builder: yargs =>
    json_option(tenant_options(yargs))
      .positional('webhook_id', {
        type: 'string',
        demandOption: true,
        description: 'Webhook id (notificationsubscription_…)'
      })
      .option('yes', {
        alias: 'y',
        type: 'boolean',
        default: false,
        description: 'Skip the confirmation prompt'
      })
      .showHelpOnFail(false) as any,
  handler: withAuthHints(async args => {
    const api = await requireAuthAdmin(args)
    const w = (await api.notificationsubscriptionGet(args.webhook_id)) as any
    const go = await confirm({
      message: `Delete webhook ${w.id} → ${w.config?.url}? Its events stop being delivered.`,
      yes: args.yes
    })
    if (!go) {
      log.info('Cancelled.')
      return
    }
    await api.notificationsubscriptionDelete(w.id)
    if (args.json) return print_json({ deleted: true, id: w.id })
    log.info(`🗑️ Deleted webhook ${w.id}.`)
  })
}
