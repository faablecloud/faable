import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import { deploy } from './commands/deploy'
import { init } from './commands/init'
import { link } from './commands/link'
import { login } from './commands/login'
import { logout } from './commands/logout'
import { whoami } from './commands/whoami'
import { version } from './config'
import { Configuration } from './lib/Configuration'
import { log } from './log'

const yg = yargs()
yg.scriptName('faable')
  .middleware(function (_argv) {
    log.info(`Faable CLI ${version}`)
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
  .command(login)
  .command(logout)
  .command(whoami)
  .command(init)
  .command(link)
  .demandCommand(1)
  .help()
  .fail(function (msg, err) {
    if (err) {
      log.error(`❌ ${err.message}`)
      process.exit(1)
      return
    }
    if (msg) {
      yg.showHelp()
      log.info(msg)
    }
  })
  .parse(hideBin(process.argv), {})
