import { cmd } from "../../lib/cmd";
import { BuilderContext } from "builder/Builder";
import { NodeBuidContext } from "./NodeBuildContext";

export const build_project = async (
  ctx: BuilderContext,
  nodeCtx: NodeBuidContext
) => {
  const { log, config, workdir } = ctx;

  // Check if exists any type of builc command
  let build_command = config.getConfigProperty(
    "buildCommand",
    process.env.FAABLE_NPM_BUILD_COMMAND
  );

  const build_script_name = config.getConfigProperty("buildScript", "build");
  const build_script = nodeCtx.pkg.scripts[build_script_name];

  // No build command but build script
  if (!build_command && build_script) {
    build_command = `npm run ${build_script_name}`;
  }

  if (build_command) {
    log.info(`✅ Build command detected. Running "${build_command}"`);
    const timeout = 1000 * 60 * 100; // 100 minute timeout

    await cmd(build_command, {
      timeout,
      cwd: workdir,
      enableOutput: true,
    });
  } else {
    log.info(`No build script in package.json`);
  }
};
