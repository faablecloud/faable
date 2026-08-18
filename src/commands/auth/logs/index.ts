import { CommandModule } from 'yargs'
import { logs_get } from './get'
import { logs_list } from './list'

export const logs: CommandModule = {
  command: 'logs',
  describe: 'Browse the audit log (read-only)',
  builder: yargs =>
    yargs
      .command(logs_list)
      .command(logs_get)
      .demandCommand(1)
      .showHelpOnFail(false) as any,
  handler: () => {}
}
