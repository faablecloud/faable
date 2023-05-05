import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { apps } from "./commands/apps";
import { configure } from "./commands/configure";
import { deploy } from "./commands/deploy";
import { log } from "./log";
import { init } from "./commands/init";
import { version } from "./config";

const yg = yargs();
yg.scriptName("faable")
  .middleware(function (argv) {
    console.log(`Faable CLI ${version}`);
  }, true)
  .command(deploy)
  .command(apps)
  .command(configure)
  .command(init)
  .demandCommand(1)
  .help()
  .fail(function (msg, err) {
    if (err) {
      log.error(`❌ ${err.message}`);
      process.exit(1);
      return;
    }
    if (msg) {
      yg.showHelp();
      log.info(msg);
    }
  })
  .parse(hideBin(process.argv), {});
