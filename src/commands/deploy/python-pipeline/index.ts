import { FaableApp, Secret } from "../../../api/FaableApi";
import { Runtime } from "../runtime-detect/RuntimeStrategy";
import { analyze_python } from "./analyze_python";
import { build_docker } from "./build_docker";

interface BuildPythonOptions {
  workdir: string;
  runtime: Runtime;
  env_vars?: Secret[];
}

export const build_python = async (
  app: FaableApp,
  options: BuildPythonOptions
) => {
  const { workdir, runtime } = options;

  if (!runtime.version) {
    throw new Error("Runtime version not specified for python");
  }

  // Resolve how to install deps and start the app. Unlike node, there is no
  // separate local build step: dependency install happens inside the Docker
  // build (where network is available), so we go straight to packaging.
  const { install_command, start_command } = await analyze_python({ workdir });

  await build_docker({
    app,
    workdir,
    install_command,
    start_command,
    template_context: {
      from: `python:${runtime.version}`,
    },
  });

  return { type: "python" };
};
