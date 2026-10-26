import { CommandModule } from 'yargs'
import { apis_create } from './create'
import { apis_get } from './get'
import { apis_list } from './list'
import { apis_update } from './update'

// The tenant's APIs (resource servers): the audiences tokens are issued for,
// their permission catalog and whether RBAC filters user tokens by role.
export const apis: CommandModule = {
  command: 'apis',
  describe:
    'Create and inspect APIs, edit their permissions and turn RBAC on or off',
  builder: yargs =>
    yargs
      .command(apis_list)
      .command(apis_get)
      .command(apis_create)
      .command(apis_update)
      .demandCommand(1)
      .showHelpOnFail(false) as any,
  handler: () => {}
}
