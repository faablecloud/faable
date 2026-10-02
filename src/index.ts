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
import { configuredProject, setProjectFlag } from './api/project'
import { ContextStore } from './lib/ContextStore'
import { CliError, error_json } from './lib/errors'
import { is_non_interactive } from './lib/interactive'
import { notifyIfUpdateAvailable } from './lib/UpdateChecker'
import { log } from './log'

// Where the command acts, on the banner — read locally, never a request.
// The flag and the env show as typed; the stored one by the name it had when
// it was chosen.
const project_badge = async () => {
  const configured = await configuredProject().catch(() => undefined)
  if (!configured) return ''
  if (configured.source !== 'config') return ` · project ${configured.ref}`
  const { project_name } = await new ContextStore().load()
  return ` · project ${project_name ?? configured.ref}`
}

// A program is reading: errors go out as JSON on stderr.
const wants_json = () =>
  process.argv.includes('--json') || is_non_interactive()

const fail_json = (err: unknown) => {
  process.stderr.write(JSON.stringify(error_json(err)) + '\n')
}

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
    // This middleware runs before the one below that records --project.
    setProjectFlag(argv.project as string | undefined)
    // --json mode is for piping: keep stdout machine-clean (no banner, no
    // update-check notice). Same for `auth users export` without a file,
    // whose stdout IS the export.
    const exports_to_stdout =
      argv._.slice(0, 3).join(' ') === 'auth users export' && !argv.file
    // Nor when nobody is watching stderr (a script, the MCP server).
    if (
      argv.json ||
      exports_to_stdout ||
      !process.stderr.isTTY ||
      is_non_interactive()
    )
      return
    log.info(`Faable CLI ${version}${await project_badge()}`)
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
  .option('non-interactive', {
    description:
      'Never prompt nor infer the app from the working directory; errors as JSON (env FAABLE_NONINTERACTIVE=1)',
    boolean: true,
    global: true
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
      // stderr, so it can tell a 404 from a 403 without parsing prose
      // (codes in lib/errors.ts).
      if (wants_json()) {
        fail_json(err)
      } else {
        log.error(`❌ ${err.message}`)
      }
      process.exit(1)
      return
    }
    if (msg) {
      // The one unknown command worth naming: an app id passed positionally.
      // `faable deploy <app_id> secrets list` used to deploy the working
      // directory instead of listing secrets, so the id now lives in a flag —
      // say so, or the migration reads as the CLI having lost a feature.
      const stray = /Unknown commands?: (app_[A-Za-z0-9_-]+)/.exec(msg)
      const hint = stray
        ? `The app id goes in a flag, not as an argument: faable deploy --app ${stray[1]} [subcommand]`
        : undefined
      if (wants_json()) {
        // A program built a bad argv: no help screen, just the reason.
        fail_json(new CliError('usage', hint ? `${msg}. ${hint}` : msg))
        process.exit(1)
      }
      // Validation failure (unknown command, missing subcommand…): show the
      // help, then fail red — a bad invocation must not exit 0.
      yg.showHelp()
      log.error(`❌ ${msg}`)
      if (hint) log.error(hint)
      process.exit(1)
    }
  })
  .parse(hideBin(process.argv), {})
