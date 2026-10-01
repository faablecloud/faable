import { CommandModule } from 'yargs'
import { accounts, auth_use } from './accounts'
import { actions } from './actions'
import { clients } from './clients'
import { logs } from './logs'
import { users } from './users'

// `faable auth` — management commands for a Faable Auth tenant. Auth: reuses
// the `faable login` session (or FAABLE_TOKEN); tenant: --account /
// --auth-url, else the active project's (`faable auth accounts list`). See
// resolveTenant in src/api/auth_admin.ts.
export const auth: CommandModule = {
  command: 'auth',
  describe: 'Manage Faable Auth (users, actions, clients, audit logs)',
  builder: yargs =>
    yargs
      .command(users)
      .command(actions)
      .command(clients)
      .command(logs)
      .command(accounts)
      .command(auth_use)
      .demandCommand(1)
      .showHelpOnFail(false) as any,
  handler: () => {}
}
