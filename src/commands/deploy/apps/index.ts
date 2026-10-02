import { CommandModule } from 'yargs'
import { apps_list } from '../inspect/list'
import { status } from '../inspect/status'

// `faable deploy apps list` — same shape as `secrets list`, `domains list` and
// `waf list`: the resource, then the verb.
export const apps: CommandModule = {
  command: 'apps <command>',
  describe: 'Apps of the active project',
  builder: yargs =>
    yargs
      .command(apps_list)
      .command(apps_get)
      .demandCommand(1, 'Specify an apps command: list or get'),
  handler: () => {
    // Unreachable: demandCommand(1) either routes to a subcommand or fails
    // through the global .fail() in src/index.ts.
  }
}

// `faable deploy apps get` — one app: what is live, the newest deployment and
// the stack. The same record `faable deploy status` shows, named like the
// rest of the resource verbs; with --json, the app plus `latest_deployment`.
export const apps_get: CommandModule = {
  ...(status as CommandModule),
  command: 'get',
  describe: 'Show one app: what is live, the latest deployment, the stack'
}

// The older `faable deploy list`, kept working but out of the help: one
// documented way to list apps.
export const apps_list_legacy: CommandModule = {
  ...(apps_list as CommandModule),
  describe: false
}
