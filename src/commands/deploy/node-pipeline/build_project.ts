import { FaableApp, Secret } from "../../../api/FaableApi";
import { log } from "../../../log";
import { cmd } from "../../../lib/cmd";
import { Configuration } from "../../../lib/Configuration";

interface BuildProjectArgs {
  /**App we are building */
  app: FaableApp;
  /**build script*/
  build_script?: string;
  cwd?: string;
  env?: Record<string, string>;
}

export const build_project = async (args: BuildProjectArgs) => {
  const build_script = args.build_script;
  const build_command = build_script
    ? `npm run ${build_script}`
    : Configuration.instance().buildCommand;

  if (build_command) {
    const cwd = args.cwd || process.cwd();
    log.info(`⚙️ Building project [${build_command}]...`);
    const timeout = 1000 * 60 * 30; // 30 minute timeout

    await cmd(build_command, {
      timeout,
      cwd,
      enableOutput: true,
    });
  } else {
    log.info(`⚡️ No build step`);
  }
};
