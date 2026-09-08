import { Argv } from 'yargs'
import { log } from '../../log'

// `faable deploy` with nothing to deploy has to show what `deploy` CAN do —
// the same way `faable auth` lists its subcommands. yargs only hands the
// parser to a builder, never to a handler, so the `deploy` builder parks its
// level here for `launch` to print.
let deploy_level: Argv | null = null

export const capture_deploy_help = (yargs: Argv) => {
  deploy_level = yargs
  return yargs
}

export const show_deploy_help = () => {
  if (deploy_level) deploy_level.showHelp(help => log.info(help))
}
