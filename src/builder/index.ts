import { Builder } from "./Builder";
import { FaableRuntime } from "commands/deploy/runtime-detect/RuntimeStrategy";

const builders: Record<FaableRuntime, any> = {
  node: () => import("./node/index.js"),
  python: () => import("./python/index.js"),
  docker: () => import("./docker/index.js"),
};

export const import_builder = async (
  runtime_name: FaableRuntime
): Promise<Builder> => {
  try {
    let builder_module = await builders[runtime_name]();
    return builder_module.default;
  } catch (e) {
    console.log(e);
    throw new Error(`Builder import error for ${runtime_name}`);
  }
};
