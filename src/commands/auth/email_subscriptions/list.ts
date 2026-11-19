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
import { print_json, table_lines, yes_no } from '../render'
import { EmailSubscription, isEmail } from './shared'

export const email_subscriptions_list: CommandModule<unknown, AuthListArgs> = {
  command: 'list',
  describe: 'List email subscriptions',
  builder: yargs =>
    list_options(tenant_options(yargs)).showHelpOnFail(false) as any,
  handler: withAuthHints(async args => {
    const api = await requireAuthAdmin(args)
    const page = await fetch_page(
      from_paginator(api.notificationsubscriptionList({})),
      args
    )
    // The resource also holds webhooks; this command is email.
    const data = (page.data as EmailSubscription[]).filter(isEmail)

    if (args.json) return print_json({ ...page, data })

    if (data.length === 0) {
      log.info(
        '📭 No email subscriptions. Create one with `faable auth email-subscriptions create`.'
      )
      return
    }
    log.info(`📧 ${data.length} email subscription(s):`)
    const rows = data.map(s => [
      s.id,
      (s.config?.recipients ?? []).join(','),
      s.events.join(','),
      yes_no(s.active)
    ])
    for (const line of table_lines(
      ['ID', 'RECIPIENTS', 'EVENTS', 'ACTIVE'],
      rows
    )) {
      print(line)
    }
    const hint = more_hint(page)
    if (hint) log.info(hint)
  })
}
