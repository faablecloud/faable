import { log } from "../../../../log";
import { cmd } from "../../../../lib/cmd";

// Pinned for reproducible builds. `serve` is the standalone static server used
// for frameworks without a bundled preview tool (CRA, Vue, Angular).
const SERVE_VERSION = "14";

/**
 * Install `serve` into the project's node_modules so it ships inside the image
 * via `COPY . .` (the Dockerfile does no `npm install`). This lets `npx serve`
 * resolve the local copy at container start — no runtime download needed.
 *
 * `--no-save` keeps the user's package.json/lockfile untouched.
 */
export const inject_serve = async (workdir: string) => {
  log.info(`📥 Injecting static server (serve@${SERVE_VERSION}) into image`);
  const timeout = 5 * 60 * 1000; // 5 minute timeout
  await cmd(
    `npm install serve@${SERVE_VERSION} --no-save --no-audit --no-fund`,
    { cwd: workdir, timeout, enableOutput: true }
  );
};
