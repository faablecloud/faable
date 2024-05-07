import { log } from "../../log";
import { upload_tag } from "./upload_tag";
import { check_environment } from "./check_environment";
import { context } from "../../api/context";
import { runtime_detection } from "./runtime-detect/runtime_detection";
import { import_builder } from "../../builder";
import { BuilderContext } from "../../builder/Builder";
import { Configuration } from "lib/Configuration";
import { cmd } from "lib/cmd";

export interface DeployCommandArgs {
  app_slug?: string;
  workdir?: string;
  project_type?: string;
  onlybuild?: boolean;
}

export const deploy_command = async (args: DeployCommandArgs) => {
  const workdir = args.workdir || process.cwd();
  const flags = {
    upload: args.onlybuild ? false : true,
  };
  const { api } = await context();

  // Check if we can build docker images
  await check_environment();

  // Resolve runtime
  const { app_name, runtime } = await runtime_detection(workdir);

  const name = args.app_slug || app_name;
  if (!name) {
    throw new Error("Missing <app_name>");
  }

  // Get app from Faable API
  const app = await api.getBySlug(name);

  log.info(`🚀 Deploying ${app.name} (${app.id}) runtime=${runtime}`);

  // Select builder
  let builder = await import_builder(runtime);

  const ctx: BuilderContext = {
    app,
    workdir,
    log: log.child({ runtime }),
    config: Configuration.instance(),
  };

  // Do build
  const { dockerfile, params } = await builder(ctx);

  // Compile docker image
  log.info(`📦 Packaging...`);
  const timeout = 10 * 60 * 1000; // 10 minute timeout
  await cmd(
    `docker build -t ${app.id} ${workdir} -f -<<EOF\n${dockerfile}\nEOF`,
    { timeout, enableOutput: true }
  );

  // Upload to Faable registry
  if (flags.upload) {
    const { upload_tagname } = await upload_tag({ app, api });

    // Create a deployment for this image
    await api.createDeployment({
      app_id: app.id,
      image: upload_tagname,
      ...(params || {}),
    });
    log.info(`🌍 Deployment created -> https://${app.url}`);
  } else {
    log.info(`❌ Upload canceled, remove --onlybuild otherwise`);
  }
};
