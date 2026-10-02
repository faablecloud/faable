import { CommandModule } from 'yargs'
import { apps_list } from '../inspect/list'

// `faable deploy apps list` — same shape as `secrets list`, `domains list` and
// `waf list`: the resource, then the verb.
export const apps: CommandModule = {
  command: 'apps <command>',
  describe: 'Apps of the active project',
  builder: yargs =>
    yargs.command(apps_list).demandCommand(1, 'Specify an apps command: list'),
  handler: () => {
    // Unreachable: demandCommand(1) either routes to a subcommand or fails
    // through the global .fail() in src/index.ts.
  }
}

// The older `faable deploy list`, kept working but out of the help: one
// documented way to list apps.
export const apps_list_legacy: CommandModule = {
  ...(apps_list as CommandModule),
  describe: false
}
