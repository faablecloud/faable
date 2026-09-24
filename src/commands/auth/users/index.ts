import { CommandModule } from 'yargs'
import { users_export } from './export'
import { users_get } from './get'
import { users_import } from './import'
import { users_list } from './list'
import { users_reinstate } from './reinstate'
import { users_suspend } from './suspend'

export const users: CommandModule = {
  command: 'users',
  describe: 'List, inspect, suspend, reinstate, import and export users',
  builder: yargs =>
    yargs
      .command(users_list)
      .command(users_get)
      .command(users_suspend)
      .command(users_reinstate)
      .command(users_import)
      .command(users_export)
      .demandCommand(1)
      .showHelpOnFail(false) as any,
  handler: () => {}
}
