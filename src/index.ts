import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import { auth } from './commands/auth'
import { deploy } from './commands/deploy'
import { link_deprecated } from './commands/link'
import { login } from './commands/login'
import { logout } from './commands/logout'
import { project } from './commands/project'
import { upgrade } from './commands/upgrade'
import { whoami } from './commands/whoami'
import { version } from './config'
import { Configuration } from './lib/Configuration'
import { setProjectFlag } from './api/project'
import { notifyIfUpdateAvailable } from './lib/UpdateChecker'
import { log } from './log'

const wants_json = () => process.argv.includes('--json')

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
    // update-check notice). Same for `auth users export` without a file,
    // whose stdout IS the export.
    const exports_to_stdout =
      argv._.slice(0, 3).join(' ') === 'auth users export' && !argv.file
    // Nor when nobody is watching stderr (a script, the MCP server).
    if (argv.json || exports_to_stdout || !process.stderr.isTTY) return
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
  .option('p', {
    alias: 'project',
    description:
      'Project to act on, id or name (env FAABLE_PROJECT; default: `faable project use`)',
    string: true,
    global: true
  })
  .middleware(function (argv) {
    setProjectFlag(argv.project as string | undefined)
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
  .command(project)
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
      // With --json the caller is a program: the error as JSON too, on
      // stderr, so it can tell a 404 from a 403 without parsing prose.
      if (wants_json()) {
        const e = err as Error & { status?: number; code?: string }
        process.stderr.write(
          JSON.stringify({
            error: {
              message: e.message,
              ...(e.code ? { code: e.code } : {}),
              ...(e.status ? { status: e.status } : {})
            }
          }) + '\n'
        )
      } else {
        log.error(`❌ ${err.message}`)
      }
      process.exit(1)
      return
    }
    if (msg) {
      // Validation failure (unknown command, missing subcommand…): show the
      // help, then fail red — a bad invocation must not exit 0.
      yg.showHelp()
      log.error(`❌ ${msg}`)
      // The one unknown command worth naming: an app id passed positionally.
      // `faable deploy <app_id> secrets list` used to deploy the working
      // directory instead of listing secrets, so the id now lives in a flag —
      // say so, or the migration reads as the CLI having lost a feature.
      const stray = /Unknown commands?: (app_[A-Za-z0-9_-]+)/.exec(msg)
      if (stray) {
        log.error(
          `The app id goes in a flag, not as an argument: faable deploy --app ${stray[1]} [subcommand]`
        )
      }
      process.exit(1)
    }
  })
  .parse(hideBin(process.argv), {})
