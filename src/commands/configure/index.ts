import { CommandModule } from "yargs";
import { FaableApi } from "../../api/FaableApi";
import { ConfigStore } from "../../lib/ConfigStore";
import { ConfigurationHelper } from "../init/ConfigurationHelper";

type Options = {
  api: FaableApi;
  app_name: string;
  workdir: string;
  remove: boolean;
};

export const configure: CommandModule<{}, Options> = {
  command: "configure",
  describe: "Configure Faable CLI",
  builder: (yargs) => {
    return yargs
      .option("remove", {
        alias: "d",
        type: "boolean",
        description: "Delete current configuration",
        default: false,
      })
      .showHelpOnFail(false) as any;
  },
  handler: async (args) => {
    const { app_name, workdir, api, remove } = args;

    const store = new ConfigStore();
    const helper = new ConfigurationHelper();
    if (remove) {
      await store.deleteCredentials();
    }
    await helper.demandConfig();
  },
};
