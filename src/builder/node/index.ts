import { bundle_docker } from "./bundle_docker";
import { analyze_package } from "./analyze_package";
import { build_project } from "./build_project";
import { Builder } from "../Builder";

export const builder: Builder = async (ctx) => {
  const { app, workdir, runtime } = ctx;
  // log.info(`🚀 Build Toolchain ${app.name} [${app.id}]`);

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

export default builder;
