import { CommandModule } from 'yargs'
import { connections_create } from './create'
import { connections_list } from './list'
import { connections_rm } from './rm'
import {
  connections_disable,
  connections_enable,
  connections_update
} from './update'

export const connections: CommandModule = {
  command: 'connections',
  describe: 'Manage the login methods of the tenant',
  builder: yargs =>
    yargs
      .command(connections_list)
      .command(connections_create)
      .command(connections_update)
      .command(connections_enable)
      .command(connections_disable)
      .command(connections_rm)
      .demandCommand(1)
      .showHelpOnFail(false) as any,
  handler: () => {}
}
