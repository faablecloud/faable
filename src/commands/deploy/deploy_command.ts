import { log } from "../../log";
import { upload_tag } from "./upload_tag";
import { check_environment } from "./check_environment";
import { context } from "../../api/context";
import { runtime_detection } from "./runtime-detect/runtime_detection";
import { import_builder } from "../../builder";
import { BuilderContext } from "../../builder/Builder";

export interface DeployCommandArgs {
  app_slug?: string;
  workdir?: string;
  project_type?: string;
}

export const deploy_command = async (args: DeployCommandArgs) => {
  const workdir = args.workdir || process.cwd();

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

  log.info(
    `🚀 Deploying ${app.name} (${app.id}) runtime=${runtime.name}-${runtime.version} `
  );

  // Select builder
  let builder = await import_builder(runtime.name);

  const ctx: BuilderContext = {
    app,
    workdir,
    runtime,
  };

  // Do build
  const build_metaparams = await builder(ctx);

  // Upload to Faable registry
  const { upload_tagname } = await upload_tag({ app, api });

  // Create a deployment for this image
  await api.createDeployment({
    app_id: app.id,
    image: upload_tagname,
    ...build_metaparams,
  });
  log.info(`🌍 Deployment created -> https://${app.url}`);
};
