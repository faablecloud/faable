import { StrategyFn } from "../RuntimeStrategy";
import fs from "fs-extra";
import path from "path";

export const has_any_of_files = (files: string[], workdir: string): boolean => {
  for (let name of files) {
    const filename = path.join(workdir, name);
    if (fs.existsSync(filename)) {
      return true;
    }
  }
  return false;
};
