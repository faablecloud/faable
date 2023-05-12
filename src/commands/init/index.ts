import { CommandModule } from "yargs";
import prompts from "prompts";
import { CredentialsStore } from "../../lib/CredentialsStore";
import { log } from "../../log";
import { ConfigurationHelper } from "./ConfigurationHelper";

export const init: CommandModule<{}, { force: boolean }> = {
  command: ["initialize", "$0"],
  describe: "Initialize Faable",
  builder: (yargs) => {
    return yargs
      .option("force", {
        alias: "f",
        type: "boolean",
        description: "Force initialization",
        default: false,
      })
      .showHelpOnFail(false) as any;
  },

  handler: async (args) => {
    const { force } = args;
    const helper = new ConfigurationHelper();

    await helper.initializeGithubAction(force);
  },
};
