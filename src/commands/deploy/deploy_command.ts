import { log } from "../../log";
import { bundle_docker } from "./bundle_docker";
import { upload_tag } from "./upload_tag";
import { check_environment } from "./check_environment";
import { analyze_package } from "./analyze_package";
import { context } from "../../api/context";
import { build_project } from "./build_project";

export interface DeployCommandArgs {
  app_slug: string;
  workdir?: string;
}

export const deploy_command = async (args: DeployCommandArgs) => {
  const app_slug = args.app_slug;
  const workdir = args.workdir || process.cwd();
  if (!app_slug) {
    throw new Error("Missing app name");
  }

  // Check if we can build docker images
  await check_environment();

  // Get registry data from api.faable.com
  const { api } = await context();
  const app = await api.getBySlug(app_slug);
  log.info(`🚀 Preparing to build ${app.name} [${app.id}]`);

  // Analyze package.json to check if build is needed
  const { build_script } = await analyze_package({ workdir });
  if (build_script) {
    await build_project({ app, build_script });
  }

  // Bundle project inside a docker image
  const { tagname } = await bundle_docker({
    app,
    workdir,
    template_context: {
      from: "node:18.12.0-slim",
      start_script: "start",
    },
  });

  // Upload to Faable registry
  await upload_tag({ app, api, tagname });

  log.info(`🌍 Deployed on https://${app.url}`);
};
