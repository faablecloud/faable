import { CommandModule } from 'yargs'
import { email_subscriptions_create } from './create'
import { email_subscriptions_list } from './list'
import { email_subscriptions_rm } from './rm'
import { email_subscriptions_update } from './update'

// Emails to the tenant's own people on its events (user.created,
// user.updated, credentials.exported), e.g. to hear about every form that
// lands as a user. Same resource as webhooks, `channel: 'email'`.
export const email_subscriptions: CommandModule = {
  command: 'email-subscriptions',
  aliases: ['emails'],
  describe: 'Manage email subscriptions (emails to your team on tenant events)',
  builder: yargs =>
    yargs
      .command(email_subscriptions_list)
      .command(email_subscriptions_create)
      .command(email_subscriptions_update)
      .command(email_subscriptions_rm)
      .demandCommand(1)
      .showHelpOnFail(false) as any,
  handler: () => {}
}
