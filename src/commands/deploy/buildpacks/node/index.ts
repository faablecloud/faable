import * as R from "ramda";
import { log } from "../../../../log";
import {
  BuildContext,
  BuildPlan,
  Buildpack,
  DetectContext,
} from "../Buildpack";
import { build_image, render_dockerfile } from "../shared/docker_image";
import { has_any_of_files } from "../shared/has_any_of_files";
import { analyze_package } from "./analyze_package";
import { build_project } from "./build_project";
import { ensure_dependencies } from "./ensure_dependencies";
import { inject_serve } from "./inject_serve";
import { resolve_node_version } from "./node_version";

const BANNER = `NODE_VERSION=$(node --version)
NPM_VERSION=$(npm --version)
YARN_VERSION=$(yarn --version 2>/dev/null || echo "n/a")

echo "Faable Cloud · [node $NODE_VERSION] [npm $NPM_VERSION] [yarn $YARN_VERSION]"`;

export const node_buildpack: Buildpack = {
  name: "node",
  detect_files: ["package.json"],

  async detect(ctx: DetectContext): Promise<BuildPlan | null> {
    if (!has_any_of_files(this.detect_files, ctx.workdir)) return null;

    const version = await resolve_node_version(ctx.workdir);
    const { build_script, type, start_command, inject_serve } =
      await analyze_package({ workdir: ctx.workdir });

    // Precedence: explicit faable.json startCommand > framework-detected
    // command (e.g. serving a static SPA) > default `npm run start`.
    const start = ctx.config.startCommand ?? start_command ?? "npm run start";

    return {
      buildpack: "node",
      runtime: { name: "node", version },
      type,
      start_command: start,
      build_script,
      inject_serve,
      from: `node:${version}`,
    };
  },

  async build(ctx: BuildContext, plan: BuildPlan): Promise<void> {
    const env = R.fromPairs(ctx.env_vars.map((e) => [e.name, e.value]));
    log.info(`Building with env variables ${Object.keys(env).join(",")}`);

    // The workflow no longer runs `npm ci` — install here when needed, before
    // the build and before `COPY . .` packages node_modules into the image.
    await ensure_dependencies(ctx.workdir);

    // Host build step: npm script from the plan, else faable.json buildCommand.
    const build_command = plan.build_script
      ? `npm run ${plan.build_script}`
      : ctx.config.buildCommand;
    await build_project({ command: build_command, env, cwd: ctx.workdir });

    // Frameworks without a bundled static server (CRA/Vue/Angular) need
    // `serve` installed into node_modules before packaging.
    if (plan.inject_serve) {
      await inject_serve(ctx.workdir);
    }

    log.info(`⚙️ Start command: ${plan.start_command}`);
    log.info(`Using docker image ${plan.from}-slim`);
    const dockerfile = render_dockerfile({
      from: plan.from as string,
      env: { NODE_ENV: "production" },
      banner: BANNER,
      start_command: plan.start_command as string,
    });
    await build_image({ app: ctx.app, workdir: ctx.workdir, dockerfile });
  },
};
