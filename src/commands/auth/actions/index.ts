import { CommandModule } from 'yargs'
import { actions_create } from './create'
import { actions_get } from './get'
import { actions_list } from './list'
import { actions_rm } from './rm'

export const actions: CommandModule = {
  command: 'actions',
  describe: 'Manage auth actions (login-flow hooks)',
  builder: yargs =>
    yargs
      .command(actions_list)
      .command(actions_get)
      .command(actions_create)
      .command(actions_rm)
      .demandCommand(1)
      .showHelpOnFail(false) as any,
  handler: () => {}
}
