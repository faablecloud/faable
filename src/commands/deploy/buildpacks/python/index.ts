import fs from "fs-extra";
import path from "path";
import { log } from "../../../../log";
import {
  BuildContext,
  BuildPlan,
  Buildpack,
  DetectContext,
} from "../Buildpack";
import { build_image, render_dockerfile } from "../shared/docker_image";
import { has_any_of_files } from "../shared/has_any_of_files";
import { read_text_file } from "../shared/read_text_file";
import { PythonProvider } from "./providers/PythonProvider";
import { cerebrium_provider } from "./providers/cerebrium";
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

const DOCS_URL = "https://faable.com/docs/deploy/build-requirements";

// Evaluated in order: the first provider whose manifest exists supplies the
// install command. Classic manifests come before platform-specific ones, so
// a repo shipping both requirements.txt and cerebrium.toml builds from the
// standard manifest.
const PROVIDERS: PythonProvider[] = [
  requirements_provider,
  pyproject_provider,
  pipfile_provider,
  cerebrium_provider,
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

  let start_command: string;
  let server;
  try {
    ({ start_command, server } = resolve_start(
      ctx.workdir,
      deps,
      ctx.config,
      resolved.start_hint
    ));
  } catch (error) {
    if (provider.name === "cerebrium") {
      throw new Error(
        "Detected a Cerebrium project (cerebrium.toml) but couldn't find a web " +
          "entrypoint. Faable runs web services — expose a FastAPI/Flask app or " +
          `set \`startCommand\` in faable.json. Docs: ${DOCS_URL}`,
        { cause: error }
      );
    }
    throw error;
  }

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
  fallback_files: ["main.py", "app.py", "wsgi.py"],

  async detect(ctx: DetectContext): Promise<BuildPlan | null> {
    const provider = PROVIDERS.find((p) =>
      has_any_of_files(p.files, ctx.workdir)
    );
    if (!provider) return null;
    return detect_with_provider(ctx, provider);
  },

  // Weak-signal pass: a Python entrypoint with no dependency manifest at all.
  // Registered as fallback so it loses against any strong trigger (Dockerfile).
  async detect_fallback(ctx: DetectContext): Promise<BuildPlan | null> {
    const entries = (this.fallback_files as string[]).filter((f) =>
      fs.existsSync(path.join(ctx.workdir, f))
    );
    if (entries.length === 0) return null;

    log.warn(
      `⚠️ No dependency manifest (requirements.txt/pyproject.toml/Pipfile) found — ` +
        `building from ${entries.join(", ")} without installing dependencies. ` +
        `Your app will likely need a requirements.txt; see ${DOCS_URL}`
    );

    // Framework detection blob = the entry files themselves: an
    // `from fastapi import FastAPI` line carries the token detection needs.
    const deps = entries
      .map((f) => read_text_file(path.join(ctx.workdir, f)))
      .join("\n")
      .toLowerCase();

    const { start_command, server } = resolve_start(ctx.workdir, deps, ctx.config);
    const install_command = with_server_injection(
      ctx.config.buildCommand,
      server,
      deps
    );

    const version = resolve_python_version(ctx.workdir);
    log.info(`Using python@${version}`);
    log.info(`📦 Install command: ${install_command}`);
    log.info(`⚙️ Start command: ${start_command}`);

    return {
      buildpack: "python",
      runtime: { name: "python", version },
      type: "python",
      start_command,
      install_command,
      from: `python:${version}`,
    };
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
