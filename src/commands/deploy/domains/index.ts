import { CommandModule } from 'yargs'
import { domains_add } from './add'
import { domains_check } from './check'
import { domains_list } from './list'
import { domains_rm } from './rm'

export const domains: CommandModule = {
  command: 'domains <command>',
  describe: 'Manage custom domains of an app',
  builder: yargs =>
    yargs
      .command(domains_list)
      .command(domains_add)
      .command(domains_check)
      .command(domains_rm)
      .demandCommand(1, 'Specify a domains command: list, add, check or rm'),
  handler: () => {
    // Unreachable: demandCommand(1) either routes to a subcommand or fails
    // through the global .fail() in src/index.ts.
  }
}
