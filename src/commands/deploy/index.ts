import { CommandModule } from "yargs";

import { deploy_command, DeployCommandArgs } from "./deploy_command";

export const deploy: CommandModule<{}, DeployCommandArgs> = {
  command: "deploy [app_slug]",
  describe: "Deploy a faable app",
  builder: (yargs) => {
    return yargs
      .positional("app_slug", {
        type: "string",
        description: "App slug",
      })
      .option("workdir", {
        alias: "w",
        type: "string",
        description: "Working directory",
      })
      .showHelpOnFail(false) as any;
  },

  handler: deploy_command,
};
