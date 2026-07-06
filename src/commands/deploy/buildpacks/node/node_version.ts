import fs from "fs-extra";
import path from "path";
import { cmd } from "../../../../lib/cmd";
import { log } from "../../../../log";

const getCurrentNodeVersion = async () => {
  const out = await cmd(`node --version`);
  const [_, version] = out.stdout.toString().trim().split("v");
  return version;
};

/**
 * Resolve the Node version for the base image: `engines.node` from
 * package.json (resolved to a concrete release via `npm view`), else the
 * version running the deploy. Also validates the package has a `name`
 * (required since the beginning; kept for compatibility).
 */
export const resolve_node_version = async (workdir: string): Promise<string> => {
  const packageJSONFile = path.join(workdir, "package.json");

  const { name, engines } = fs.readJSONSync(packageJSONFile);
  if (!name) {
    throw new Error("Missing name in package.json");
  }

  let runtime_version = await getCurrentNodeVersion();
  if (engines?.node) {
    try {
      const check_cmd = `npm view node@"${engines.node}" version | tail -n 1 | cut -d "'" -f2`;
      const out = await cmd(check_cmd);
      runtime_version = out.stdout.toString().trim();
      log.info(
        `Using node@${runtime_version} from engines in package.json (${engines.node})`
      );
    } catch {
      log.info(
        `Node version defined in engines in package.json is not valid (${engines.node}), using current version ${runtime_version}`
      );
    }
  } else {
    log.info(`Node version ${runtime_version}`);
  }

  return runtime_version;
};
