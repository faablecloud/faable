import { log } from "../../log";
import { upload_tag } from "./upload_tag";
import { check_environment } from "./check_environment";
import { context } from "../../api/context";
import { build_node } from "./node-pipeline";
import { runtime_detection } from "./runtime-detect/runtime_detection";
import { cmd } from "../../lib/cmd";

export interface DeployCommandArgs {
  app_slug?: string;
  workdir?: string;
  project_type?: string;
}

export const deploy_command = async (args: DeployCommandArgs) => {
  const workdir = args.workdir || process.cwd();

  const { api } = await context();

  // Resolve runtime
  const { app_name, runtime } = await runtime_detection(workdir);

  const name = args.app_slug || app_name;
  if (!name) {
    throw new Error("Missing <app_name>");
  }

  // Get app from Faable API
  const app = await api.getBySlug(name);

  // Check if we can build docker images
  await check_environment();

  log.info(
    `🚀 Deploying ${app.name} (${app.id}) runtime=${runtime.name}-${runtime.version} `
  );

  let type;

  if (runtime.name == "node") {
    const node_result = await build_node(app, {
      workdir,
      runtime,
    });
    type = node_result.type;
  } else if (runtime.name == "docker") {
    type = "node";
    await cmd(`docker build -t ${app.id} .`, {
      enableOutput: true,
    });
  } else {
    throw new Error(`No build pipeline for runtime=${runtime.name}`);
  }

  // Upload to Faable registry
  const { upload_tagname } = await upload_tag({ app, api });

  // Create a deployment for this image
  await api.createDeployment({ app_id: app.id, image: upload_tagname, type });
  log.info(`🌍 Deployment created -> https://${app.url}`);
};
