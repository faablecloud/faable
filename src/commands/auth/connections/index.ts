import { CommandModule } from 'yargs'
import { connections_list } from './list'

export const connections: CommandModule = {
  command: 'connections',
  describe: 'List the login methods of the tenant',
  builder: yargs =>
    yargs.command(connections_list).demandCommand(1).showHelpOnFail(false) as any,
  handler: () => {}
}
