import { FaableApp } from "../../api/FaableApi";
import { log } from "../../log";
import { cmd } from "./cmd";

interface BuildProjectArgs {
  /**App we are building */
  app: FaableApp;
  /**build script*/
  build_script?: string;
  cwd?: string;
}

export const build_project = async (args: BuildProjectArgs) => {
  const cwd = args?.cwd || process.cwd();
  const build_script = args?.build_script || "build";
  const app = args.app;
  log.info(`⚡️ Running build script [${build_script}]...`);
  const timeout = 1000 * 60 * 10; // 10 minute timeout
  await cmd("yarn", ["run", build_script], {
    timeout,
    cwd,
    enableOutput: true,
  });
};
