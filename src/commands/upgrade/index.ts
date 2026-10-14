import ora from "ora";
import { CommandModule } from "yargs";
import { version } from "../../config";
import {
  CLI_PACKAGE,
  getLatestVersion,
  isDevBuild,
  isNewerVersion,
} from "../../lib/UpdateChecker";
import { npmDeps, upgradeTo } from "../../lib/self_upgrade";
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
    const res = await upgradeTo(latest, npmDeps, {
      onRetry: () => {
        spinner.text = `${latest} was just published and the npm registry is still propagating it — retrying…`;
      },
    });
    if (res.ok) {
      spinner.succeed(`Upgraded to ${latest}`);
      return;
    }

    spinner.fail("Upgrade failed");
    if (res.reason === "not_propagated") {
      log.error(
        `❌ ${latest} is not available from the npm registry yet (still on ${res.installed ?? version}). A release takes a few minutes to propagate — run \`faable upgrade\` again shortly.`
      );
    } else {
      if (res.output) log.error(res.output.trim());
      log.error(
        `❌ Could not upgrade automatically. Try manually: npm install -g ${CLI_PACKAGE}@${latest}`
      );
    }
    process.exit(1);
  },
};
