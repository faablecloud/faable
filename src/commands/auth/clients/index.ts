import { CommandModule } from 'yargs'
import { clients_create } from './create'
import { clients_get } from './get'
import { clients_list } from './list'
import { clients_rm } from './rm'

export const clients: CommandModule = {
  command: 'clients',
  describe: 'Manage OAuth clients',
  builder: yargs =>
    yargs
      .command(clients_list)
      .command(clients_get)
      .command(clients_create)
      .command(clients_rm)
      .demandCommand(1)
      .showHelpOnFail(false) as any,
  handler: () => {}
}
