import { CommandModule } from "yargs";
import { FaableApi } from "../../api/FaableApi";
import { CredentialsStore } from "../../lib/CredentialsStore";
import prompts from "prompts";

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

    const store = new CredentialsStore();

    if (remove) {
      await store.deleteCredentials();
    }

    const { apikey } = await prompts([
      {
        type: "text",
        name: "apikey",
        message: "What is your Faable ApiKey?",
      },
    ]);
    await store.saveApiKey({ apikey });
  },
};
