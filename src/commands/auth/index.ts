import { CommandModule } from 'yargs'
import { actions } from './actions'
import { clients } from './clients'
import { logs } from './logs'
import { users } from './users'

// `faable auth` — management commands for a Faable Auth tenant. Auth: reuses
// the `faable login` session (or FAABLE_TOKEN); tenant: --auth-url /
// FAABLE_AUTH_URL (defaults to the Faable tenant host). See
// src/api/auth_admin.ts.
export const auth: CommandModule = {
  command: 'auth',
  describe: 'Manage Faable Auth (users, actions, clients, audit logs)',
  builder: yargs =>
    yargs
      .command(users)
      .command(actions)
      .command(clients)
      .command(logs)
      .demandCommand(1)
      .showHelpOnFail(false) as any,
  handler: () => {}
}
