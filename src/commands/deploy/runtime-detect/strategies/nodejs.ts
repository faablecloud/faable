import { StrategyFn } from "../RuntimeStrategy";
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
 * Strategy to detect app name from package.json
 * @param api
 * @param workdir
 * @returns
 */
export const strategy_nodejs: StrategyFn = async (workdir: string) => {
  const packageJSONFile = path.join(workdir, "package.json");

  // Check we have a valid name
  const { name, engines } = fs.readJSONSync(packageJSONFile);
  if (!name) {
    throw new Error("Missing name in package.json");
  }

  // Use engines.node if found
  let runtime_version = await getCurrentNodeVersion();
  if (engines?.node) {
    try {
      const check_cmd = `npm view node@"${engines.node}" version | tail -n 1 | cut -d "'" -f2`;
      const out = await cmd(check_cmd);
      runtime_version = out.stdout.toString().trim();
      log.info(
        `Using node@${runtime_version} from engines in package.json (${engines.node})`
      );
    } catch (e) {
      log.info(
        `Node version defined in engines in package.json is not valid (${engines.node}), using current version ${runtime_version}`
      );
    }
  } else {
    log.info(`Node version ${runtime_version}`);
  }

  return {
    app_name: name,
    runtime: {
      name: "node",
      version: runtime_version,
    },
  };
};
