import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { deploy } from "./commands/deploy";

yargs(hideBin(process.argv))
  .scriptName("faable")
  .command(deploy)
  .demandCommand(1)
  .parse();
