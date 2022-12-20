import { CommandModule } from "yargs";

export const deploy: CommandModule<any, { app_name: string }> = {
  command: "deploy <app_name>",
  describe: "Deploy a faable app",
  builder: (yargs) => {
    return yargs.showHelpOnFail(false);
  },
  handler: async (args) => {
    const { app_name } = args;
    if (!app_name) {
      throw new Error("Missing app_name");
    }
  },
};
