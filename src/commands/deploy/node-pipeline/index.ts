import { FaableApp } from "../../../api/FaableApi";
import { log } from "../../../log";
import { bundle_docker } from "./bundle_docker";
import { analyze_package } from "./analyze_package";
import { build_project } from "./build_project";

export const build_node = async (app: FaableApp, workdir: string) => {
  // log.info(`🚀 Build Toolchain ${app.name} [${app.id}]`);

  // Analyze package.json to check if build is needed
  const { build_script, type } = await analyze_package({ workdir });
  await build_project({ app, build_script });

  // Bundle project inside a docker image
  await bundle_docker({
    app,
    workdir,
    template_context: {
      from: "node:18.19.0-slim",
    },
  });

  return { type };
};
