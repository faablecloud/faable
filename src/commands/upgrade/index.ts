import ora from "ora";
import { CommandModule } from "yargs";
import { version } from "../../config";
import {
  CLI_PACKAGE,
  getLatestVersion,
  isDevBuild,
  isNewerVersion,
} from "../../lib/UpdateChecker";
import { cmd } from "../../lib/cmd";
import { log } from "../../log";

export const upgrade: CommandModule = {
  command: "upgrade",
  describe: "Upgrade the Faable CLI to the latest version",
  handler: async () => {
    if (isDevBuild(version)) {
      log.warn("Development build, skipping self-upgrade");
      return;
    }

    const latest = await getLatestVersion();
    if (!latest) {
      log.error("❌ Could not reach the npm registry to check for updates");
      process.exit(1);
    }

    if (!isNewerVersion(latest, version)) {
      log.info(`✅ Already on the latest version (${version})`);
      return;
    }

    const spinner = ora(`Upgrading ${CLI_PACKAGE} ${version} → ${latest}`).start();
    try {
      await cmd(`npm install -g ${CLI_PACKAGE}@latest`, { timeout: 180_000 });
      spinner.succeed(`Upgraded to ${latest}`);
    } catch {
      spinner.fail("Upgrade failed");
      log.error(
        `❌ Could not upgrade automatically. Try manually: npm install -g ${CLI_PACKAGE}@latest`
      );
      process.exit(1);
    }
  },
};
