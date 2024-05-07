import { prepare_dockerfile } from "./prepare_dockerfile";
import { analyze_package } from "./analyze_package";
import { build_project } from "./build_project";
import { Builder } from "../Builder";
import { engine_version } from "./engine_version";

export const builder: Builder = async (ctx) => {
  // log.info(`🚀 Build Toolchain ${app.name} [${app.id}]`);

  const { version } = await engine_version(ctx);

  // Analyze package.json to check if build is needed
  const nodeCtx = await analyze_package(ctx);
  await build_project(ctx, nodeCtx);

  // Bundle project inside a docker image
  const { dockerfile } = await prepare_dockerfile(ctx, {
    template_context: {
      from: `node:${version}`,
    },
  });

  return {
    dockerfile,
    params: {
      type: nodeCtx.type,
    },
  };
};

export default builder;
