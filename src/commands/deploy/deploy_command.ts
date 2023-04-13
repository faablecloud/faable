import { log } from "../../log";
import { bundle_docker } from "./bundle_docker";
import { upload_tag } from "./upload_tag";
import { check_environment } from "./check_environment";
import { analyze_package } from "./analyze_package";
import { context } from "../../api/context";
import { build_project } from "./build_project";
import fs from "fs-extra";
import path from "path";
import { FaableApi, FaableApp } from "../../api/FaableApi";
export interface DeployCommandArgs {
  app_slug?: string;
  workdir?: string;
}

const get_app = async (
  api: FaableApi,
  app_slug: string,
  workdir: string
): Promise<FaableApp> => {
  let slug;
  console.log("slug", app_slug);
  if (app_slug) {
    slug = app_slug;
  } else {
    const packageJSONFile = path.join(workdir, "package.json");
    if (!fs.existsSync(packageJSONFile)) {
      throw new Error("Not found package.json");
    }
    const { name } = fs.readJSONSync(packageJSONFile);
    if (!name) {
      throw new Error("Missing name in package.json");
    }
    slug = name;
  }

  return api.getBySlug(slug);
};

export const deploy_command = async (args: DeployCommandArgs) => {
  const workdir = args.workdir || process.cwd();

  // Get registry data from api.faable.com
  const { api } = await context();
  const app = await get_app(api, args.app_slug, workdir);

  // Check if we can build docker images
  await check_environment();

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
