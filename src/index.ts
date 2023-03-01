import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { apps } from "./commands/apps";
import { configure } from "./commands/configure";
import { deploy } from "./commands/deploy";
import { log } from "./log";

const yg = yargs();
yg.scriptName("faable")
  .command(deploy)
  .command(apps)
  .command(configure)
  .demandCommand(1)
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
