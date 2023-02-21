import { CommandModule } from "yargs";
import { log } from "../../log";
import { build_docker } from "./build_docker";
import { upload_tag } from "./upload_tag";
import fs from "fs-extra";
import { check_environment } from "./check_environment";
import { analyze_package } from "./analyze_package";
import { context } from "../../api/context";

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

    // Check environment is ready
    await check_environment();

    // Get registry data from api.faable.com
    const { api } = await context();
    const app = await api.getBySlug(app_name);
    log.info(`⚡️ Building app "${app.name}"`);

    // Analyze package.json
    const { hasBuild } = await analyze_package({ workdir });

    // Build docker image
    await build_docker({
      app_name,
      workdir,
      template_context: {
        from: "node:18.12.0-slim",
        build_script: hasBuild && "build",
        start_script: "start",
      },
    });
    log.info(`⚙️ Image ready. Uploading...`);

    // Upload using api.faable.com data
    const registry = await api.getRegistry(app.id);
    await upload_tag({ registry });
    log.info(`✅ Upload completed.`);
  },
};
