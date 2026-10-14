import { CommandModule } from 'yargs'
import { requireAuthAdmin, withAuthHints } from '../../../api/auth_admin'
import {
  fetch_page,
  from_paginator,
  more_hint,
  print
} from '../../../lib/listing'
import { log } from '../../../log'
import { AuthListArgs, list_options, tenant_options } from '../options'
import { print_json, table_lines, when, yes_no } from '../render'
import { WebhookSubscription, isWebhook } from './shared'

export const webhooks_list: CommandModule<unknown, AuthListArgs> = {
  command: 'list',
  describe: 'List webhooks',
  builder: yargs =>
    list_options(tenant_options(yargs)).showHelpOnFail(false) as any,
  handler: withAuthHints(async args => {
    const api = await requireAuthAdmin(args)
    const page = await fetch_page(
      from_paginator(api.notificationsubscriptionList({})),
      args
    )
    // The resource also holds email subscriptions; this command is webhooks.
    const data = (page.data as WebhookSubscription[]).filter(isWebhook)

    if (args.json) return print_json({ ...page, data })

    if (data.length === 0) {
      log.info('📭 No webhooks. Create one with `faable auth webhooks create`.')
      return
    }
    log.info(`🪝 ${data.length} webhook(s):`)
    const rows = data.map(w => [
      w.id,
      w.config?.url ?? '-',
      w.events.join(','),
      yes_no(w.active),
      w.status ?? '-',
      when(w.last_success_at)
    ])
    for (const line of table_lines(
      ['ID', 'URL', 'EVENTS', 'ACTIVE', 'STATUS', 'LAST OK'],
      rows
    )) {
      print(line)
    }
    const hint = more_hint(page)
    if (hint) log.info(hint)
  })
}
