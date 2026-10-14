import { CommandModule } from 'yargs'
import { requireAuthAdmin, withAuthHints } from '../../../api/auth_admin'
import { log } from '../../../log'
import { TenantArgs, json_option, tenant_options } from '../options'
import { print_json } from '../render'
import { SECRET_WARNING } from './shared'

interface WebhooksCreateArgs extends TenantArgs {
  url: string
  event: string[]
  secret?: string
  disabled?: boolean
}

export const webhooks_create: CommandModule<unknown, WebhooksCreateArgs> = {
  command: 'create',
  describe: 'Create a webhook (prints its signing secret once)',
  builder: yargs =>
    json_option(tenant_options(yargs))
      .option('url', {
        type: 'string',
        demandOption: true,
        description: 'Where deliveries are POSTed. Must be https.'
      })
      .option('event', {
        alias: 'e',
        type: 'string',
        array: true,
        demandOption: true,
        description:
          'Event to subscribe to, e.g. user.created — repeatable. Unknown events are refused by the server with the list of valid ones.'
      })
      .option('secret', {
        type: 'string',
        description:
          'Use this signing secret instead of a generated one (whsec_…)'
      })
      .option('disabled', {
        type: 'boolean',
        default: false,
        description: 'Create it inactive: nothing is delivered until enabled'
      })
      .example(
        '$0 auth webhooks create --url https://app.example.com/api/webhooks/faable-auth -e user.created',
        'Get a signed POST on every new user'
      )
      .example(
        '$0 auth webhooks create --url https://… -e user.created --json | jq -r .secret',
        'Capture the secret for a script'
      )
      .showHelpOnFail(false) as any,
  handler: withAuthHints(async args => {
    const api = await requireAuthAdmin(args)
    const created = (await api.notificationsubscriptionCreate({
      channel: 'webhook',
      events: args.event,
      active: !args.disabled,
      config: {
        url: args.url,
        ...(args.secret ? { secret: args.secret } : {})
      }
    } as any)) as any

    if (args.json) return print_json(created)

    log.info(`✅ Created webhook ${created.id}`)
    log.info(`  URL:    ${created.config?.url}`)
    log.info(`  Events: ${(created.events ?? []).join(', ')}`)
    log.info(`  Active: ${created.active ? 'yes' : 'no'}`)
    if (created.secret) {
      log.info(`  Signing secret: ${created.secret}`)
      log.info(`  ${SECRET_WARNING}`)
    }
    log.info(
      `  Check it end to end with \`faable auth webhooks test ${created.id}\`.`
    )
  })
}
