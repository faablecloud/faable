import yargs, { middleware } from "yargs";
import { hideBin } from "yargs/helpers";
import { faable_api } from "./api/faable_api";
import { deploy } from "./commands/deploy";
import { log } from "./log";

const yg = yargs();
yg.scriptName("faable")
  .command(deploy)
  .demandCommand(1)
  .fail(function (msg, err) {
    if (err) {
      console.log(`❌ ${err.message}`);
      process.exit(1);
      return;
    }
    if (msg) {
      yg.showHelp();
      log.info(msg);
    }
  })
  .parse(hideBin(process.argv), { api: faable_api() });
