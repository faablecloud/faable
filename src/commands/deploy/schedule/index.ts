import { CommandModule } from 'yargs'
import { schedule_add } from './add'
import { schedule_list } from './list'
import { schedule_rm } from './rm'
import { schedule_disable, schedule_enable } from './toggle'

// Task schedules (api `/taskschedule`, Hobby and Pro): a cron expression that
// runs a task of the app — the same thing `faable deploy run` runs once.
export const schedule: CommandModule = {
  command: 'schedule <command>',
  describe: 'Run a command of the app on a cron schedule (Hobby and Pro)',
  builder: yargs =>
    yargs
      .command(schedule_list)
      .command(schedule_add)
      .command(schedule_enable)
      .command(schedule_disable)
      .command(schedule_rm)
      .demandCommand(
        1,
        'Specify a schedule command: list, add, enable, disable or rm'
      ),
  handler: () => {
    // Unreachable: demandCommand(1) either routes to a subcommand or fails
    // through the global .fail() in src/index.ts.
  }
}
