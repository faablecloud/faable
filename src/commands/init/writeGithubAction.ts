import path from "path";
import fs from "fs-extra";
import { log } from "../../log";
import prompts from "prompts";
import { CredentialsStore } from "../../lib/CredentialsStore";
import yaml from "yaml";


const store: CredentialsStore = new CredentialsStore();
  const get_workflows_dir = ()=> {
    return path.join(process.cwd(), ".github", "workflows");
  }

  const get_default_action=()=> {
    return path.join(get_workflows_dir(), "deploy.yml");
  }

  const  demandConfig = async(force: boolean = false) =>{
    const creds = await store.loadCredentials();
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
    await store.saveApiKey({ apikey });
  }

  const tentativeName = async() => {
    try {
      const pkg = path.join(process.cwd(), "package.json");
      const { name } = await fs.readJSON(pkg);
      return name;
    } catch (error) {
      return;
    }
  }

  const  checkPackageManager = async()=> {
    if (fs.existsSync(path.join(process.cwd(), "package-lock.json"))) {
      return "npm";
    }
    if (fs.existsSync(path.join(process.cwd(), "yarn.lock"))) {
      return "yarn";
    }
    throw new Error("No package-lock.json or yarn.lock file found");
  }


type WriteGithubActionParams = {
  overwrite?: boolean
}

export const  writeGithubAction = async(params:WriteGithubActionParams = {}) => {

  const {overwrite} = params
    await demandConfig();

    const gh_action_file = get_default_action();
    // Already configured
    if (!overwrite && fs.pathExistsSync(gh_action_file)) {
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
          initial: await tentativeName(),
          message: "Which app are you deploying",
        },
      ],
      { onCancel }
    );

    const manager = await checkPackageManager();
    const action = {
      name: "Deploy to Faable",
      on: {
        push: {
          branches: ["main"],
        },
      },
      permissions:{
        "id-token": "write",
        "contents": "read"
      },
      jobs: {
        deploy: {
          "runs-on": "ubuntu-latest",
          steps: [
            { uses: "actions/checkout@v2" },
            {
              uses: "actions/setup-node@v4",
              with: {
                "node-version": "lts/*",
              },
            },
            ...(manager == "npm" ? [{ run: "npm ci" }] : []),
            ...(manager == "yarn"
              ? [{ run: "yarn install --frozen-lockfile" }]
              : []),
            {
              name: "Deploy to Faable",
              run: `npx @faable/faable deploy ${app_name}`,
            },
          ],
        },
      },
    };

    
    await fs.writeFile(gh_action_file, yaml.stringify(action));
    log.info(`Written ${gh_action_file}`);
  }