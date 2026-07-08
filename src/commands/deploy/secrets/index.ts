import { CommandModule } from 'yargs'
import { secrets_list } from './list'
import { secrets_rm } from './rm'
import { secrets_set } from './set'

export const secrets: CommandModule = {
  command: 'secrets <command>',
  describe: 'Manage app secrets (environment variables)',
  builder: yargs =>
    yargs
      .command(secrets_list)
      .command(secrets_set)
      .command(secrets_rm)
      .demandCommand(1, 'Specify a secrets command: list, set or rm'),
  handler: () => {
    // Unreachable: demandCommand(1) either routes to a subcommand or fails
    // through the global .fail() in src/index.ts.
  }
}
