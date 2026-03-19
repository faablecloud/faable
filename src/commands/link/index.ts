import { CommandModule } from "yargs";
import { context } from "../../api/context";
import prompts from "prompts";
import { log } from "../../log";
import { cmd } from "../../lib/cmd";
import { Configuration } from "../../lib/Configuration";

type Options = { workdir: string };

const getGitRemoteUrl = async (workdir: string): Promise<string | undefined> => {
  try {
    const { stdout } = await cmd("git remote get-url origin", { cwd: workdir });
    return stdout?.toString().trim();
  } catch (error) {
    log.warn("Could not detect git remote origin URL.");
    return undefined;
  }
};

export const link: CommandModule<object, Options> = {
  command: "link",
  describe: "Link the local repository with a Faable app",
  builder: (yargs) => {
    return yargs
      .option("workdir", {
        alias: "w",
        type: "string",
        description: "Working directory",
      })
      .showHelpOnFail(false) as any;
  },
  handler: async (args) => {
    const workdir = args.workdir || process.cwd();
    const { api } = await context();

    log.info("Checking local git repository...");
    const gitUrl = await getGitRemoteUrl(workdir);

    const apps = await api.list();

    if (apps.length === 0) {
      log.error("No apps found in your account. Create one first at https://faable.cloud");
      return;
    }

    const { selectedApp } = await prompts({
      type: "select",
      name: "selectedApp",
      message: "Select the Faable app to link with this repository:",
      choices: apps.map((app) => ({
        title: `${app.name} (${app.url})`,
        value: app,
      })),
    });

    if (!selectedApp) {
      log.info("Link cancelled.");
      return;
    }

    log.info(`Linking to ${selectedApp.name}...`);

    // Update the app in the API
    if (gitUrl) {
      await api.updateApp(selectedApp.id, { github_repo: gitUrl });
      log.info(`Updated app ${selectedApp.name} with github_repo: ${gitUrl}`);
    } else {
      log.warn("No git remote URL detected. Skipping API update for github_repo.");
    }

    // Save locally for CLI convenience
    Configuration.instance().saveConfig({ app_slug: selectedApp.name });
    log.info(`Successfully linked local repository to ${selectedApp.name}.`);
  },
};
