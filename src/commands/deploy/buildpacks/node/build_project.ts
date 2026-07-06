import { log } from "../../../../log";
import { cmd } from "../../../../lib/cmd";

interface BuildProjectArgs {
  /** Resolved host build command (from the plan), or none for no build step. */
  command?: string;
  cwd: string;
  env?: Record<string, string>;
}

export const build_project = async (args: BuildProjectArgs) => {
  const { command, cwd } = args;

  if (command) {
    log.info(`⚙️ Building project [${command}]...`);
    const timeout = 1000 * 60 * 30; // 30 minute timeout

    await cmd(command, {
      timeout,
      cwd,
      enableOutput: true,
      ...(args?.env ? { env: args?.env } : {}),
    });
  } else {
    log.info(`⚡️ No build step`);
  }
};
