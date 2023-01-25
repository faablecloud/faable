import fs from "fs-extra";
import path from "path";
import { log } from "../../log";
import { PackageJson } from "type-fest";

interface AnalyzePackage {
  workdir: string;
}

export const analyze_package = async ({ workdir }: AnalyzePackage) => {
  const package_file = path.join(path.resolve(workdir), "package.json");
  log.info(`Reading ${package_file}`);
  const pkg: PackageJson = await fs.readJSON(package_file);

  // Package must have a start script
  if (!pkg?.scripts?.start) {
    throw new Error("Missing start script on package.json");
  }

  // Check if build is required to run
  let hasBuild = false;
  if (pkg?.scripts?.build) {
    log.info(`Build script found`);
    hasBuild = true;
  } else {
    log.info(`No build script found`);
  }

  return {
    hasBuild,
  };
};
