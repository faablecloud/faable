import { CommandModule } from "yargs";
import fs from "fs-extra";
import { deploy_command, DeployCommandArgs } from "./deploy_command";

export const deploy: CommandModule<{}, DeployCommandArgs> = {
  command: "deploy [app_name]",
  describe: "Deploy a faable app",
  builder: (yargs) => {
    return yargs
      .positional("app_name", {
        type: "string",
        description: "App name to build for",
        default: (s) => {
          const { name } = fs.readJSONSync("./package.json");
          return name;
        },
      })
      .option("workdir", {
        alias: "w",
        type: "string",
        description: "Working directory",
      })
      .showHelpOnFail(false) as any;
  },

  handler: async (args) => deploy_command(args),
};
