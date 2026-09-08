import { CommandModule } from 'yargs'
import { link } from '../link'
import { domains } from './domains'
import { capture_deploy_help } from './help'
import { cancel } from './inspect/cancel'
import { deployments } from './inspect/deployments'
import { inspect } from './inspect/inspect'
import { apps_list } from './inspect/list'
import { logs } from './inspect/logs'
import { open_app } from './inspect/open'
import { redeploy } from './inspect/redeploy'
import { status } from './inspect/status'
import { trigger } from './inspect/trigger'
import { launch } from './launch'
import { secrets } from './secrets'
import { waf } from './waf'

export type { DeployCommandArgs } from './launch'

// `faable deploy` — the deploy product. A command group and nothing else: it
// holds no handler of its own, so every verb is a subcommand and the
// hierarchy has no exception to remember. Deploying is `launch`, registered
// as the group's default ($0) so `faable deploy` on its own still deploys the
// current directory — the shortcut is an alias, not a second code path.
//
// The group deliberately has no positional. An app id typed where a
// subcommand belongs (`faable deploy app_xxx secrets list`) used to be
// swallowed by an `[app_id]` positional and silently DEPLOYED instead of
// running the subcommand; .strictCommands() in src/index.ts now rejects it as
// an unknown command. Another app is targeted with --app on `launch` and on
// every subcommand alike.
export const deploy: CommandModule = {
  command: 'deploy',
  // Name the subcommand groups so `faable --help` makes them discoverable
  // without digging into `faable deploy --help`.
  describe:
    'Deploy a faable app and manage it (secrets, domains, logs, deployments…)',
  builder: yargs =>
    capture_deploy_help(
      yargs
        .command(launch)
        .command(secrets)
        .command(domains)
        .command(waf)
        .command(logs)
        .command(status)
        .command(apps_list)
        .command(deployments)
        .command(inspect)
        .command(open_app)
        .command(trigger)
        .command(redeploy)
        .command(cancel)
        .command(link)
        .showHelpOnFail(false)
    ) as any,

  // Unreachable: `launch` is the default command, so yargs routes a bare
  // `faable deploy` there before it ever gets here.
  handler: () => {}
}
