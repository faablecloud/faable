import fs from "fs-extra";
import path from "path";
import { PackageJson } from "type-fest";
import { BuilderContext } from "builder/Builder";
import { NodeBuidContext, NodeBuildType } from "./NodeBuildContext";

export const analyze_package = async (
  ctx: BuilderContext
): Promise<NodeBuidContext> => {
  const { log, workdir } = ctx;

  const node_modules_dir = path.join(path.resolve(workdir), "node_modules");

  const installedModules = await fs.pathExists(node_modules_dir);
  if (!installedModules) {
    throw new Error("node_modules not found, please install packages first");
  }

  const package_file = path.join(path.resolve(workdir), "package.json");
  const pkg: PackageJson = await fs.readJSON(package_file);

  // Detect deployment type
  let type: NodeBuildType = "node";
  if (pkg.dependencies["next"]) {
    type = "next";
    log.info(`✅ Next.js ⚡️ project detected`);
  }

  return {
    pkg,
    type,
  };
};
