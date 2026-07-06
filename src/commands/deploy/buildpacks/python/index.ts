import { log } from "../../../../log";
import {
  BuildContext,
  BuildPlan,
  Buildpack,
  DetectContext,
} from "../Buildpack";
import { build_image, render_dockerfile } from "../shared/docker_image";
import { has_any_of_files } from "../shared/has_any_of_files";
import { PythonProvider } from "./providers/PythonProvider";
import { pipfile_provider } from "./providers/pipfile";
import { pyproject_provider } from "./providers/pyproject";
import { requirements_provider } from "./providers/requirements";
import { resolve_python_version } from "./python_version";
import {
  read_dependencies_text,
  resolve_start,
  with_server_injection,
} from "./resolve_start";

const BANNER = `PYTHON_VERSION=$(python --version 2>&1)
PIP_VERSION=$(pip --version 2>&1)

echo "Faable Cloud · [$PYTHON_VERSION] [$PIP_VERSION]"`;

// Evaluated in order: the first provider whose manifest exists supplies the
// install command. Classic manifests come before platform-specific ones.
const PROVIDERS: PythonProvider[] = [
  requirements_provider,
  pyproject_provider,
  pipfile_provider,
];

const detect_with_provider = (
  ctx: DetectContext,
  provider: PythonProvider
): BuildPlan => {
  const resolved = provider.resolve(ctx.workdir);

  // Framework detection blob: all classic manifests plus whatever the winning
  // provider contributes (e.g. cerebrium pip package names).
  const deps = [read_dependencies_text(ctx.workdir), resolved.deps_text ?? ""]
    .join("\n")
    .toLowerCase();

  const { start_command, server } = resolve_start(
    ctx.workdir,
    deps,
    ctx.config,
    resolved.start_hint
  );

  // faable.json buildCommand overrides the provider's install. The cacheable
  // manifest layer only applies to the provider's own command — an arbitrary
  // buildCommand may need the full source.
  const base_install = ctx.config.buildCommand ?? resolved.install_command;
  const install_command = with_server_injection(base_install, server, deps);
  const install_files = ctx.config.buildCommand
    ? undefined
    : resolved.install_files;

  const version = resolve_python_version(ctx.workdir, resolved.python_version);
  log.info(`Using python@${version}`);
  log.info(`📦 Install command: ${install_command}`);
  log.info(`⚙️ Start command: ${start_command}`);

  return {
    buildpack: "python",
    runtime: { name: "python", version },
    type: "python",
    start_command,
    install_command,
    install_files,
    from: `python:${version}`,
  };
};

export const python_buildpack: Buildpack = {
  name: "python",
  detect_files: PROVIDERS.flatMap((p) => p.files),

  async detect(ctx: DetectContext): Promise<BuildPlan | null> {
    const provider = PROVIDERS.find((p) =>
      has_any_of_files(p.files, ctx.workdir)
    );
    if (!provider) return null;
    return detect_with_provider(ctx, provider);
  },

  async build(ctx: BuildContext, plan: BuildPlan): Promise<void> {
    // Dependencies install inside the image (unlike node); nothing runs on
    // the host here.
    log.info(`Using docker image ${plan.from}-slim`);
    const dockerfile = render_dockerfile({
      from: plan.from as string,
      env: { PYTHONUNBUFFERED: "1" },
      banner: BANNER,
      start_command: plan.start_command as string,
      install_command: plan.install_command,
      install_files: plan.install_files,
    });
    await build_image({ app: ctx.app, workdir: ctx.workdir, dockerfile });
  },
};
