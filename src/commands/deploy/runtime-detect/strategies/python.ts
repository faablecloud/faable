import { StrategyFn } from "../RuntimeStrategy";
import fs from "fs-extra";
import path from "path";

export const strategy_python: StrategyFn = async (workdir: string) => {
  const runtime_config = path.join(workdir, "runtime.txt");

  // Default runtime
  let runtime_version = "3.11.3";

  // Select runtime based on config
  if (fs.existsSync(runtime_config)) {
    const runtime_data = fs.readFileSync(runtime_config).toString();
    if (!runtime_data.startsWith("python-")) {
      throw new Error(
        "runtime.txt must have runtime format with python-<version>"
      );
    }
    runtime_version = runtime_data.split("-")[1];
  }

  return {
    runtime: "python",
  };
};
