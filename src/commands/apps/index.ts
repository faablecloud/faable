import { CommandModule } from "yargs";
import { context } from "../../api/context";

type Options = { app_name: string; workdir: string };

export const apps: CommandModule<{}, Options> = {
  command: "apps",
  describe: "Manage Faable Cloud Apps",
  builder: (yargs) => {
    return yargs.showHelpOnFail(false) as any;
  },
  handler: async (args) => {
    const { api } = await context();

    const apps = await api.list();
    console.log("Apps...");
    console.log(apps.map((app) => app.name));
  },
};
