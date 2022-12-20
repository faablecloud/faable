import { CommandModule } from "yargs";
import { log } from "../../log";
import { build_docker } from "./build_docker";
import { prepare } from "./prepare";
import { upload_tag } from "./upload_tag";
import fs from "fs-extra";

type Options = { app_name: string; workdir: string };

export const deploy: CommandModule<{}, Options> = {
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
        default: process.cwd(),
      })
      .showHelpOnFail(false) as any;
  },
  handler: async (args) => {
    const { app_name, workdir } = args;
    if (!app_name) {
      throw new Error("Missing app_name");
    }

    log.info(`Building ${app_name}`);
    await prepare({ from_image: "node:18.12.0", workdir });

    await build_docker({ app_name, workdir });

    // TODO: get this data from Faable API
    //faablecloud#${ctx.faable_user}+deployment
    await upload_tag({ app_name, user: "", key: "" });
  },
};
