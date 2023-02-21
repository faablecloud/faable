import { CommandModule } from "yargs";
import prompts from "prompts";
import { FaableAppsApi } from "../../api/faable_api";
import fs from "fs-extra";
import os from "os";
import path from "path";
type Options = {
  api: FaableAppsApi;
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

    const faable_home = path.join(os.homedir(), ".faable");
    if (remove) {
      await fs.remove(faable_home);
      console.log("Deleted faable config");
      return;
    }

    const response = await prompts([
      {
        type: "text",
        name: "clientId",
        message: "What is your Faable clientId?",
      },
      {
        type: "text",
        name: "clientSecret",
        message: "What is your Faable clientSecret?",
      },
    ]);
    await fs.ensureDir(faable_home);
    await fs.writeJSON(path.join(faable_home, "credentials"), response);
    console.log("Stored credentials");
  },
};
