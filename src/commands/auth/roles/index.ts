import { CommandModule } from 'yargs'
import { roles_create } from './create'
import { roles_get } from './get'
import { roles_list } from './list'
import { roles_permissions } from './permissions'
import { roles_rm } from './rm'

// Roles with permissions (RBAC): a role grants permissions of your APIs; a
// user assigned the role (`faable auth users roles`) gets them in tokens for
// an API with RBAC on (`faable auth apis update --rbac`). Team roles are
// names only and grant none.
export const roles: CommandModule = {
  command: 'roles',
  describe: 'Manage roles and the API permissions they grant (RBAC)',
  builder: yargs =>
    yargs
      .command(roles_list)
      .command(roles_get)
      .command(roles_create)
      .command(roles_permissions)
      .command(roles_rm)
      .demandCommand(1)
      .showHelpOnFail(false) as any,
  handler: () => {}
}
