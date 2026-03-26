import { CommandModule } from "yargs";
import { context } from "../../api/context";
import prompts from "prompts";
import { log } from "../../log";
import { cmd } from "../../lib/cmd";
import { Configuration } from "../../lib/Configuration";

type Options = { workdir: string, app_id?:string};

const getGitRemoteUrl = async (workdir: string): Promise<string | undefined> => {
  try {
    const { stdout } = await cmd("git remote get-url origin", { cwd: workdir });
    const url = stdout?.toString().trim();
    if (!url) return undefined;

    // Extract org/repo from github urls
    const match = url.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
    if (match) {
      return match[1];
    }
    return url;
  } catch (error) {
    log.warn("Could not detect git remote origin URL.");
    return undefined;
  }
};

export const link: CommandModule<object, Options> = {
  command: "link [app_id]",
  describe: "Link the local repository with a Faable app",
  builder: (yargs) => {
    return yargs
      .positional("app_id", {
        type: "string",
        description: "app_id to link this repository",
      })
      .option("workdir", {
        alias: "w",
        type: "string",
        description: "Working directory",
      })
      .showHelpOnFail(false) as any;
  },
  handler: async (args) => {
    const workdir = args.workdir || process.cwd();

    const {app_id } = args
    const config = Configuration.instance();
    if (config.app_id) {
      log.info(`This repository is already linked to app: "${config.app_slug}" (${config.app_id})`);
      const { relink } = await prompts({
        type: "toggle",
        name: "relink",
        message: "Do you want to link it to a different app?",
        initial: false,
        active: "yes",
        inactive: "no",
      });
      if (!relink) {
        return;
      }
    }

    const { api } = await context();

    log.info("Checking local git repository...");
    const gitUrl = await getGitRemoteUrl(workdir);


    let selectedApp;
    if(!app_id){
      const apps = await api.list();

      if (apps.length === 0) {
        log.error("No apps found in your account. Create one first at https://faable.com");
        return;
      }

      selectedApp = await prompts({
        type: "select",
        name: "selectedApp",
        message: "Select the Faable app to link with this repository:",
        choices: apps.map((app) => ({
          title: `${app.name} (${app.url})`,
          value: app,
        })),
      });
    }else{
      selectedApp = await api.getApp(app_id)
    }

    if (!selectedApp) {
      log.info("Link cancelled.");
      return;
    }

    log.info(`Linking to "${selectedApp.name}" (${selectedApp.id})...`);

    // Update the app in the API
    if (gitUrl) {
      await api.updateApp(selectedApp.id, { repository: gitUrl });
      log.info(`Updated app with github_repo: ${gitUrl}`);
    } else {
      log.warn("No git remote URL detected. Skipping API update for github_repo.");
    }

    // Save locally for CLI convenience
    Configuration.instance().saveConfig({ app_slug: selectedApp.name, app_id:selectedApp.id });
    log.info(`Successfully linked local repository to ${selectedApp.name}.`);
  },
};
