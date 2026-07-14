import path from "path";
import { log } from "../../../../log";
import { PackageJson } from "type-fest";
import { read_json_file } from "../shared/read_text_file";
import { detect_framework } from "./frameworks";
interface AnalyzePackage {
  workdir: string;
}

export const analyze_package = async (params: AnalyzePackage) => {
  const workdir = params.workdir;

  const package_file = path.join(path.resolve(workdir), "package.json");
  log.info(`Loading config from package.json`);
  const pkg = read_json_file<PackageJson>(package_file);

  // Check if build is required to run
  const build_script = process.env.FAABLE_NPM_BUILD_SCRIPT
    ? process.env.FAABLE_NPM_BUILD_SCRIPT
    : pkg?.scripts?.["build"]
    ? "build"
    : null;

  if (!build_script) {
    log.info(`No build script on package.json`);
  }

  const has_start = Boolean(pkg?.scripts?.["start"]);
  const { type, start_command, inject_serve } = detect_framework({
    pkg,
    workdir,
    has_start,
  });

  log.info(`⚡️ Detected deployment type=${type}`);

  return {
    build_script,
    type,
    start_command,
    inject_serve,
  };
};
