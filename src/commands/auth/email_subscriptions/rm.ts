import { CommandModule } from 'yargs'
import { requireAuthAdmin, withAuthHints } from '../../../api/auth_admin'
import { confirm } from '../../../lib/interactive'
import { log } from '../../../log'
import { TenantArgs, json_option, tenant_options } from '../options'
import { print_json } from '../render'
import { isEmail } from './shared'

interface EmailSubscriptionsRmArgs extends TenantArgs {
  subscription_id: string
  yes?: boolean
}

export const email_subscriptions_rm: CommandModule<
  unknown,
  EmailSubscriptionsRmArgs
> = {
  command: 'rm <subscription_id>',
  describe: 'Delete an email subscription',
  builder: yargs =>
    json_option(tenant_options(yargs))
      .positional('subscription_id', {
        type: 'string',
        demandOption: true,
        description: 'Subscription id (notificationsubscription_…)'
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
    const s = (await api.notificationsubscriptionGet(
      args.subscription_id
    )) as any
    if (!isEmail(s)) {
      throw new Error(
        `${s.id} is a webhook, not an email subscription: use \`faable auth webhooks rm\`.`
      )
    }
    const go = await confirm({
      message: `Delete email subscription ${s.id} → ${(s.config?.recipients ?? []).join(', ')}? Those emails stop.`,
      yes: args.yes
    })
    if (!go) {
      log.info('Cancelled.')
      return
    }
    await api.notificationsubscriptionDelete(s.id)
    if (args.json) return print_json({ deleted: true, id: s.id })
    log.info(`🗑️ Deleted email subscription ${s.id}.`)
  })
}
