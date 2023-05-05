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
  const build_script = args.build_script;
  if (build_script) {
    const cwd = args.cwd || process.cwd();
    log.info(`⚡️ Running build [${build_script}]...`);
    const timeout = 1000 * 60 * 10; // 10 minute timeout

    await cmd("yarn", ["run", build_script], {
      timeout,
      cwd,
      enableOutput: true,
    });
  } else {
    log.info(`⚡️ No build step`);
  }
};
