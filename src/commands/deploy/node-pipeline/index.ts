import { FaableApp } from "../../../api/FaableApi";
import { bundle_docker } from "./bundle_docker";
import { analyze_package } from "./analyze_package";
import { build_project } from "./build_project";
import { Runtime } from "../runtime-detect/RuntimeStrategy";

interface BuildNodeOptions {
  workdir: string;
  runtime: Runtime;
}

export const build_node = async (app: FaableApp, options: BuildNodeOptions) => {
  // log.info(`🚀 Build Toolchain ${app.name} [${app.id}]`);
  const { workdir, runtime } = options;

  if (!runtime.version) {
    throw new Error("Runtime version not specified for node");
  }
  // Analyze package.json to check if build is needed
  const { build_script, type } = await analyze_package({ workdir });
  await build_project({ app, build_script });

  // Bundle project inside a docker image
  await bundle_docker({
    app,
    workdir,
    template_context: {
      from: `node:${runtime.version}`,
    },
  });

  return { type };
};
