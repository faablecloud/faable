import { StrategyFn } from "../RuntimeStrategy";
import fs from "fs-extra";
import path from "path";

/**
 * Strategy to detect app name from package.json
 * @param api
 * @param workdir
 * @returns
 */
export const strategy_nodejs: StrategyFn = async (workdir: string) => {
  const packageJSONFile = path.join(workdir, "package.json");

  // Check we have a valid name
  const { name } = fs.readJSONSync(packageJSONFile);
  if (!name) {
    throw new Error("Missing name in package.json");
  }

  return {
    app_name: name,
    runtime: "node",
  };
};
