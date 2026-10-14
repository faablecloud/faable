import { CommandModule } from 'yargs'
import { webhooks_create } from './create'
import { webhooks_get } from './get'
import { webhooks_list } from './list'
import { webhooks_rm } from './rm'
import { webhooks_rotate_secret } from './rotate_secret'
import { webhooks_test } from './test'
import { webhooks_update } from './update'

// Signed HTTP notifications of the tenant's events (user.created, …) to your
// server. Deliveries carry `x-faable-signature` (HMAC-SHA256 of
// `${x-faable-timestamp}.${body}`) and `x-faable-delivery` (same id on every
// retry); failures are retried for ~15 h.
export const webhooks: CommandModule = {
  command: 'webhooks',
  describe: 'Manage webhooks (signed notifications of tenant events)',
  builder: yargs =>
    yargs
      .command(webhooks_list)
      .command(webhooks_get)
      .command(webhooks_create)
      .command(webhooks_update)
      .command(webhooks_test)
      .command(webhooks_rotate_secret)
      .command(webhooks_rm)
      .demandCommand(1)
      .showHelpOnFail(false) as any,
  handler: () => {}
}
