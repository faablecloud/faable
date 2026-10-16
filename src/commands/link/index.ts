import { CommandModule } from "yargs";
import { requireApi } from "../../api/context";
import prompts from "prompts";
import { log } from "../../log";
import { getGitRemoteUrl } from "../../lib/git_remote";
import { CliError } from "../../lib/errors";
import { is_non_interactive } from "../../lib/interactive";
import { print_json } from "../../lib/listing";
import { parse_repo } from "../deploy/apps/create";
import { resolve_app_ref } from "../deploy/resolve_app_id";

const DEPLOY_DOCS_URL = "https://faable.com/docs/deploy/github-actions";

type Options = {
  workdir?: string;
  app?: string;
  repo?: string;
  branch?: string;
  json?: boolean;
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
      .option("app", {
        alias: "a",
        type: "string",
        description:
          "App id, name or slug to link (no list to pick from: what a script or agent uses)",
      })
      .option("repo", {
        alias: "r",
        type: "string",
        description:
          "GitHub repository, owner/repo or its URL (defaults to the origin remote of --workdir)",
      })
      .option("branch", {
        alias: "b",
        type: "string",
        description: "Branch to deploy (defaults to the repository default)",
      })
      .option("json", {
        type: "boolean",
        default: false,
        description:
          "Print the link as JSON: app, repository, branch and how it deploys",
      })
      .example(
        "$0 deploy link --app web --repo acme/web",
        "Link acme/web to the app web: from now on a push deploys it"
      )
      .showHelpOnFail(false) as any;
  },
  handler: async (args) => {
    if (args.app || args.json || is_non_interactive()) {
      return link_to_app(args);
    }
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

    log.info("Checking local git repository...");
    const gitUrl = await getGitRemoteUrl(workdir);
    if (!gitUrl) {
      log.error(
        "No git remote URL detected. Add a GitHub 'origin' remote and try again."
      );
      return;
    }

    const { api } = await requireApi();

    const apps = await api.list();
    if (apps.length === 0) {
      log.error("No apps found in your account. Create one first at https://faable.com");
      return;
    }

    // The link lives in the API (app.repository) — every command resolves the
    // app from the git remote, so nothing is written locally. Warn (and
    // confirm) when the repository is already linked to an app.
    const alreadyLinked = apps.filter((app) => app.repository === gitUrl);
    if (alreadyLinked.length > 0) {
      const names = alreadyLinked
        .map((app) => `"${app.name}" (${app.id})`)
        .join(", ");
      log.info(`This repository is already linked to: ${names}`);
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

    // The API verifies that the user has a connected GitHub identity AND
    // access to the repository before persisting the link.
    let linked;
    try {
      linked = await api.linkRepository(
        selectedApp.id,
        { repository: gitUrl },
        selectedApp.team
      );
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

    // Deploy v4: push-to-deploy is server-side by default — no workflow to
    // scaffold. A repo that brings its own Faable workflow keeps deploying
    // through it (the API leaves the trigger on the Action in that case).
    const branch = linked?.github_branch || "main";
    if (linked?.deploy_trigger === "webhook") {
      log.info(
        `Push to deploy is on: every push to "${branch}" deploys automatically.`
      );
      log.info(`Prefer deploying from your own CI? Docs: ${DEPLOY_DOCS_URL}`);
    } else {
      log.info(
        `This repository has its own Faable deploy workflow — pushes to "${branch}" keep deploying through it. Docs: ${DEPLOY_DOCS_URL}`
      );
    }
  },
};

// `link --app`: the app is named, so nothing is asked. What a script or an
// agent runs — the picker above needs a person, and the MCP could not link a
// repository to an existing app at all (arch/deploy/cli-mcp-fallos-2026-10-16-plan.md,
// F4; backlog §366). Driven by a program, the repository is spelled out too:
// the origin remote of whatever directory the process runs in is a guess.
const link_to_app = async (args: Options) => {
  if (!args.app) {
    throw new CliError(
      "app_required",
      "Say which app to link: --app <id|name>. Without a terminal there is no list to pick from."
    );
  }
  const repository = args.repo
    ? parse_repo(args.repo)
    : is_non_interactive()
      ? undefined
      : await getGitRemoteUrl(args.workdir || process.cwd());
  if (!repository) {
    throw new CliError(
      "usage",
      is_non_interactive()
        ? "Say which repository to link: --repo owner/repo."
        : "No GitHub origin remote here: pass --repo owner/repo."
    );
  }

  const { api } = await requireApi();
  const app = await api.getApp(await resolve_app_ref(api, args.app));

  let linked;
  try {
    linked = await api.linkRepository(
      app.id,
      { repository, ...(args.branch ? { github_branch: args.branch } : {}) },
      app.team
    );
  } catch (err) {
    const e = err as Error & { code?: string; status?: number; action?: string };
    const failed = new CliError(
      "usage",
      `Could not link ${repository} to ${app.name}: ${e.message}`,
      { status: e.status, action: e.action, cause: err }
    );
    // The api's reason (github_installation_missing,
    // github_repository_not_found…) says what to fix.
    if (e.code) failed.code = e.code;
    throw failed;
  }

  const result = {
    app_id: app.id,
    app_name: app.name,
    repository: linked?.repository ?? repository,
    branch: linked?.github_branch,
    deploy_trigger: linked?.deploy_trigger,
  };
  if (args.json) return print_json(result);
  log.info(`Linked ${result.repository} to ${app.name} (${app.id}).`);
  log.info(
    result.deploy_trigger === "webhook"
      ? `Push to deploy is on: the next push to "${result.branch ?? "the default branch"}" deploys. What is live now stays until then.`
      : `This repository has its own Faable deploy workflow — pushes keep deploying through it. Docs: ${DEPLOY_DOCS_URL}`
  );
};

// Top-level `faable link` predates the per-product layout (`faable deploy link`).
// Kept as a hidden alias so existing docs/scripts don't break; remove in a
// future major.
export const link_deprecated: CommandModule<object, Options> = {
  ...link,
  describe: false,
  deprecated: true,
  handler: async args => {
    log.warn('⚠️ "faable link" is deprecated, use "faable deploy link".')
    await link.handler(args)
  }
}

