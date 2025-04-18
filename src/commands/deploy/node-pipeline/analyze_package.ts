import fs from "fs-extra";
import path from "path";
import { log } from "../../../log";
import { PackageJson } from "type-fest";
import * as R from "ramda";
interface AnalyzePackage {
  workdir: string;
}

export const analyze_package = async (params: AnalyzePackage) => {
  const workdir = params.workdir;

  const package_file = path.join(path.resolve(workdir), "package.json");
  log.info(`Loading config from package.json`);
  const pkg: PackageJson = await fs.readJSON(package_file);

  // Check if build is required to run
  const build_script = process.env.FAABLE_NPM_BUILD_SCRIPT
    ? process.env.FAABLE_NPM_BUILD_SCRIPT
    : pkg?.scripts["build"]
    ? "build"
    : null;

  if (!build_script) {
    log.info(`No build script on package.json`);
  }

  let type: string = "node";

  // Detect nextjs deployment type
  const next_dep = R.lensPath(["dependencies", "next"]);
  const next_devdep = R.lensPath(["devDependencies", "next"]);
  if (R.view(next_dep, pkg) || R.view(next_devdep, pkg)) {
    type = "next";
  }

  log.info(`⚡️ Detected deployment type=${type}`);

  return {
    build_script,
    type,
  };
};
