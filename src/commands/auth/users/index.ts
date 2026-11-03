import { CommandModule } from 'yargs'
import { users_diagnose } from './diagnose'
import { users_export } from './export'
import { users_get } from './get'
import { users_import } from './import'
import { users_list } from './list'
import { users_password_setup } from './password_setup'
import { users_permissions } from './permissions'
import { users_reinstate } from './reinstate'
import { users_roles } from './roles'
import { users_set_password } from './set_password'
import { users_suspend } from './suspend'
import { users_tickets } from './tickets'
import { users_update } from './update'

export const users: CommandModule = {
  command: 'users',
  describe:
    'List, count, inspect, update, suspend, reinstate, set passwords for, import and export users, and manage their roles',
  builder: yargs =>
    yargs
      .command(users_list)
      .command(users_get)
      .command(users_diagnose)
      .command(users_update)
      .command(users_suspend)
      .command(users_reinstate)
      .command(users_set_password)
      .command(users_password_setup)
      .command(users_tickets)
      .command(users_roles)
      .command(users_permissions)
      .command(users_import)
      .command(users_export)
      .demandCommand(1)
      .showHelpOnFail(false) as any,
  handler: () => {}
}
