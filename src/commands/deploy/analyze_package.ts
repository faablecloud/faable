import fs from "fs-extra";
import path from "path";
import { log } from "../../log";
import { PackageJson } from "type-fest";

interface AnalyzePackage {
  workdir: string;
  build_script?: string;
}

export const analyze_package = async (params: AnalyzePackage) => {
  const workdir = params.workdir;

  const package_file = path.join(path.resolve(workdir), "package.json");
  log.info(`Loading config from package.json...`);
  const pkg: PackageJson = await fs.readJSON(package_file);

  // Package must have a start script
  if (!pkg?.scripts?.start) {
    throw new Error("Missing start script");
  }

  // Check if build is required to run
  const build_script =
    process.env.NPM_BUILD_SCRIPT || params.build_script || "build";
  let build = pkg?.scripts[build_script];
  if (!build) {
    log.info(`No build script found`);
  }

  // Detect deployment type
  let type: string = "node";
  if (pkg.dependencies["next"]) {
    type = "next";
  }

  log.info(`⚙️ Detected deployment type=${type}`);

  return {
    build_script,
    type,
  };
};
