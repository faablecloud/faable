import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import { auth } from './commands/auth'
import { deploy } from './commands/deploy'
import { link_deprecated } from './commands/link'
import { login } from './commands/login'
import { logout } from './commands/logout'
import { upgrade } from './commands/upgrade'
import { whoami } from './commands/whoami'
import { version } from './config'
import { Configuration } from './lib/Configuration'
import { notifyIfUpdateAvailable } from './lib/UpdateChecker'
import { log } from './log'

// yargs re-runs before-validation middlewares once per nested command level
// (`deploy secrets` = 2 runs), so keep the banner and update check to one.
let banner_shown = false

const yg = yargs()
yg.scriptName('faable')
  // Keep CLI output in English regardless of the system locale
  .locale('en')
  .middleware(async function (argv) {
    if (banner_shown) return
    banner_shown = true
    // --json mode is for piping: keep stdout machine-clean (no banner, no
    // update-check notice).
    if (argv.json) return
    log.info(`Faable CLI ${version}`)
    // `upgrade` does its own (forced) check
    if (argv._[0] !== 'upgrade') {
      await notifyIfUpdateAvailable(version)
    }
  }, true)
  .option('c', {
    alias: 'config',
    description: 'Path to the local `faable.json` file',
    string: true
  })
  .middleware(function (argv) {
    if (argv.config) {
      Configuration.instance().setConfigFile(argv.config as any, {
        ignoreWarnings: false
      })
    } else {
      Configuration.instance()
    }
  }, true)
  .command(deploy)
  .command(auth)
  .command(login)
  .command(logout)
  .command(whoami)
  .command(upgrade)
  .command(link_deprecated)
  .demandCommand(1)
  // Reject unknown (sub)commands loudly. Without this, a typo'd or
  // not-yet-existing command (`faable secrets list` on a version where it
  // lived elsewhere) exited silently with just the version banner.
  .strictCommands()
  .help()
  .fail(function (msg, err) {
    if (err) {
      log.error(`❌ ${err.message}`)
      process.exit(1)
      return
    }
    if (msg) {
      // Validation failure (unknown command, missing subcommand…): show the
      // help, then fail red — a bad invocation must not exit 0.
      yg.showHelp()
      log.error(`❌ ${msg}`)
      process.exit(1)
    }
  })
  .parse(hideBin(process.argv), {})
