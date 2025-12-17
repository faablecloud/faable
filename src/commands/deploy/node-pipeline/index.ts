import { FaableApp, Secret } from "../../../api/FaableApi";
import { build_docker } from "./build_docker";
import { analyze_package } from "./analyze_package";
import { build_project } from "./build_project";
import { Runtime } from "../runtime-detect/RuntimeStrategy";
import * as R from "ramda";
import { log } from "../../../log";

interface BuildNodeOptions {
  workdir: string;
  runtime: Runtime;
  env_vars?: Secret[];
}

export const build_node = async (app: FaableApp, options: BuildNodeOptions) => {
  // log.info(`🚀 Build Toolchain ${app.name} [${app.id}]`);
  const { workdir, runtime, env_vars } = options;

  if (!runtime.version) {
    throw new Error("Runtime version not specified for node");
  }
  // Analyze package.json to check if build is needed
  const { build_script, type } = await analyze_package({ workdir });

  // Environment variables

  const env = R.fromPairs(env_vars.map((e) => [e.name, e.value]));
  log.info(`Building with env variables ${Object.keys(env).join(",")}`);

  // Do build
  await build_project({ app, build_script, env });

  // Bundle project inside a docker image
  await build_docker({
    app,
    workdir,
    template_context: {
      from: `node:${runtime.version}`,
    },
  });

  return { type };
};
