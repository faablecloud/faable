import { CommandModule } from "yargs";
import { requireApi } from "../../api/context";
import prompts from "prompts";
import { log } from "../../log";
import { cmd } from "../../lib/cmd";
import { Configuration } from "../../lib/Configuration";
import {
  DEPLOY_DOCS_URL,
  DEPLOY_WORKFLOW_PATH,
  DEPLOY_WORKFLOW_YAML,
  workflowExists,
  writeWorkflow,
} from "./workflow_template";

type Options = { workdir: string };

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
  } catch {
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

    // `faable link <app_id>` is deprecated. Linking is now fully interactive and
    // the repository is auto-detected from the current folder — users never need
    // to look up an app_id. Warn if an extra positional was passed and ignore it.
    const stray = (args._ ?? []).slice(1);
    if (stray.length > 0) {
      log.warn(
        'Passing an app_id to "faable link" is deprecated and ignored. ' +
          'Just run "faable link" and select the app from the list.'
      );
    }

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

    const { api } = await requireApi();

    log.info("Checking local git repository...");
    const gitUrl = await getGitRemoteUrl(workdir);

    const apps = await api.list();
    if (apps.length === 0) {
      log.error("No apps found in your account. Create one first at https://faable.com");
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

    log.info(`Linking to "${selectedApp.name}" (${selectedApp.id})...`);

    if (!gitUrl) {
      log.error(
        "No git remote URL detected. Add a GitHub 'origin' remote and try again."
      );
      return;
    }

    // The API verifies that the user has a connected GitHub identity AND
    // access to the repository before persisting the link.
    try {
      await api.linkRepository(selectedApp.id, { repository: gitUrl });
    } catch (err) {
      const code = (err as any)?.code as string | undefined;
      switch (code) {
        case "github_identity_missing":
          log.error(
            "You have not connected a GitHub account to Faable. Connect GitHub in the dashboard, then re-run `faable link`."
          );
          break;
        case "github_token_invalid":
          log.error(
            "Your GitHub authorization has expired. Reconnect GitHub in the dashboard, then re-run `faable link`."
          );
          break;
        case "github_installation_missing":
          log.error(
            "The Faable GitHub App is not installed on your repositories. Install it from the Faable dashboard, then re-run `faable link`."
          );
          break;
        case "github_repository_not_found":
          log.error(
            `Faable can't access "${gitUrl}". Check the repository name and that the Faable GitHub App is installed on it.`
          );
          break;
        default:
          log.error(
            `Could not link repository: ${(err as Error)?.message ?? err}`
          );
      }
      return;
    }

    log.info(`Linked repository ${gitUrl} to ${selectedApp.name}.`);

    // Save locally for CLI convenience (only after the API confirms the link)
    Configuration.instance().saveConfig({ app_slug: selectedApp.name, app_id:selectedApp.id });
    log.info(`Successfully linked local repository to ${selectedApp.name}.`);

    // Onboarding: deploys happen via a GitHub Actions workflow on push. Offer
    // to scaffold it, and always explain the next steps so the user isn't left
    // wondering why nothing deploys.
    await setupDeployWorkflow(workdir);
  },
};

const setupDeployWorkflow = async (workdir: string) => {
  if (workflowExists(workdir)) {
    log.info(
      `Deploy workflow already present at ${DEPLOY_WORKFLOW_PATH}. Commit & push to "main" to deploy.`
    );
    return;
  }

  const { create } = await prompts({
    type: "toggle",
    name: "create",
    message: `Create the GitHub Actions deploy workflow (${DEPLOY_WORKFLOW_PATH})?`,
    initial: true,
    active: "yes",
    inactive: "no",
  });

  if (create) {
    const filePath = await writeWorkflow(workdir);
    log.info(`Created ${filePath}`);
    log.info("Next steps:");
    log.info("  1. Commit the workflow file");
    log.info('  2. Push to "main" — that triggers your first deploy');
    log.info(`Docs: ${DEPLOY_DOCS_URL}`);
  } else {
    log.info(
      `Skipped. To enable automated deploys, add ${DEPLOY_WORKFLOW_PATH} with:`
    );
    log.info(`\n${DEPLOY_WORKFLOW_YAML}`);
    log.info(`Then commit & push to "main". Docs: ${DEPLOY_DOCS_URL}`);
  }
};
