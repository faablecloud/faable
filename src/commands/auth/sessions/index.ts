import { CommandModule } from 'yargs'
import { sessions_list } from './list'
import { sessions_revoke } from './revoke'

export const sessions: CommandModule = {
  command: 'sessions',
  describe: "List and revoke users' sessions (signed-in devices)",
  builder: yargs =>
    yargs
      .command(sessions_list)
      .command(sessions_revoke)
      .demandCommand(1)
      .showHelpOnFail(false) as any,
  handler: () => {}
}
