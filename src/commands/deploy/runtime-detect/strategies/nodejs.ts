import { StrategyFn } from "../RuntimeStrategy";
import fs from "fs-extra";
import path from "path";
import { cmd } from "../../../../lib/cmd";
import { log } from "../../../../log";

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
  let runtime_version = "18.19.0";
  if (engines?.node) {
    try {
      const out = await cmd(
        `npm view node@${engines.node} version | tail -n 1 | cut -d "'" -f2`
      );
      runtime_version = out.stdout.toString();
      log.info(
        `Using node@${runtime_version} from engines in package.json (${engines.node})`
      );
    } catch (e) {
      throw new Error(`Node version is not valid (${engines.node})`);
    }
  }

  return {
    app_name: name,
    runtime: {
      name: "node",
      version: runtime_version,
    },
  };
};
