import path from "path";
import fs from "fs-extra";
import { log } from "../../log";
import prompts from "prompts";
import { CredentialsStore } from "../../lib/CredentialsStore";
import yaml from "yaml";

export class ConfigurationHelper {
  store: CredentialsStore;
  constructor() {
    this.store = new CredentialsStore();
  }

  get workflows_dir() {
    return path.join(process.cwd(), ".github", "workflows");
  }

  get default_action() {
    return path.join(this.workflows_dir, "deploy.yml");
  }

  async demandConfig(force: boolean = false) {
    const creds = await this.store.loadCredentials();
    if (creds?.apikey) {
      return;
    }
    const { apikey } = await prompts([
      {
        type: "text",
        name: "apikey",
        message: "What is your Faable ApiKey?",
      },
    ]);
    await this.store.saveApiKey({ apikey });
  }

  async tentativeName() {
    try {
      const pkg = path.join(process.cwd(), "package.json");
      const { name } = await fs.readJSON(pkg);
      return name;
    } catch (error) {
      return;
    }
  }

  async checkPackageManager() {
    if (fs.existsSync(path.join(process.cwd(), "package-lock.json"))) {
      return "npm";
    }
    if (fs.existsSync(path.join(process.cwd(), "yarn.lock"))) {
      return "yarn";
    }
    throw new Error("No package-lock.json or yarn.lock file found");
  }

  async initializeGithubAction(force: boolean = false) {
    await this.demandConfig();

    // Already configured
    if (!force && fs.pathExistsSync(this.default_action)) {
      log.info(`Github action is already configured.`);
      return;
    }

    const onCancel = (prompt) => {
      log.info("Cancel");
      process.exit(0);
    };

    const { app_name } = await prompts(
      [
        {
          type: "text",
          name: "app_name",
          initial: await this.tentativeName(),
          message: "Which app are you deploying",
        },
      ],
      { onCancel }
    );

    const manager = await this.checkPackageManager();
    const action = {
      name: "Deploy to Faable",
      on: {
        push: {
          branches: ["main"],
        },
      },
      env: {
        FAABLE_APIKEY: "${{ secrets.FAABLE_APIKEY }}",
      },
      jobs: {
        deploy: {
          "runs-on": "ubuntu-latest",
          steps: [
            { uses: "actions/checkout@v2" },
            { name: "Prepare CLI", run: "npm i -g @faable/faable" },
            {
              uses: "actions/setup-node@v3",
              with: {
                "node-version": "18",
                cache: manager,
              },
            },
            ...(manager == "npm" ? [{ run: "npm ci" }] : []),
            ...(manager == "yarn"
              ? [{ run: "yarn install --frozen-lockfile" }]
              : []),
            {
              name: "Deploy to Faable",
              run: `faable deploy ${app_name}`,
            },
          ],
        },
      },
    };

    await fs.writeFile(this.default_action, yaml.stringify(action));
    log.info(`Written ${this.default_action}`);
    log.info(`Remember to create FAABLE_APIKEY on Github repo secrets`);
  }
}
