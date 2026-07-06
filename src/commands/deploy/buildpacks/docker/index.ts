import fs from "fs-extra";
import path from "path";
import { cmd } from "../../../../lib/cmd";
import { log } from "../../../../log";
import {
  BuildContext,
  BuildPlan,
  Buildpack,
  DetectContext,
} from "../Buildpack";
import { has_any_of_files } from "../shared/has_any_of_files";

// A package.json with a next dependency beside the Dockerfile means this is a
// Next.js app shipped with a custom image: emit type "next" so the backend
// provisions the build-cache PVC (runtime_strategy). Reachable via the
// --buildpack override, since the node buildpack claims package.json first.
const detect_next = (workdir: string): boolean => {
  try {
    const pkg = fs.readJSONSync(path.join(workdir, "package.json"));
    return Boolean(pkg?.dependencies?.next || pkg?.devDependencies?.next);
  } catch {
    return false;
  }
};

export const docker_buildpack: Buildpack = {
  name: "docker",
  detect_files: ["Dockerfile"],

  async detect(ctx: DetectContext): Promise<BuildPlan | null> {
    if (!has_any_of_files(this.detect_files, ctx.workdir)) return null;
    const type = detect_next(ctx.workdir) ? "next" : "node";
    return {
      buildpack: "docker",
      runtime: { name: "docker" },
      type,
      // The user's image defines its own CMD/ENTRYPOINT.
      start_command: null,
    };
  },

  async build(ctx: BuildContext): Promise<void> {
    log.info(`📦 Building with the project's own Dockerfile`);
    const timeout = 10 * 60 * 1000; // 10 minute timeout
    await cmd(
      `docker build --platform linux/amd64 -t ${ctx.app.id} ${ctx.workdir} -f ${path.join(
        ctx.workdir,
        "Dockerfile"
      )}`,
      { timeout, enableOutput: true }
    );
  },
};
