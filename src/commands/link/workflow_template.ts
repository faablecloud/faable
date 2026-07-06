import { mkdir, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { dirname, join } from "path";

// The canonical GitHub Actions workflow that deploys a Faable app on push.
// Mirrors the docs at https://faable.com/docs/deploy/github-actions.
export const DEPLOY_WORKFLOW_PATH = ".github/workflows/deploy.yaml";

export const DEPLOY_WORKFLOW_YAML = `name: Deploy to Faable
on:
  push:
    branches:
      - main
permissions:
  id-token: write
  contents: write
  pull-requests: write
  issues: write
jobs:
  deploy:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
      - run: npx @faable/faable@latest deploy
`;

export const DEPLOY_DOCS_URL = "https://faable.com/docs/deploy/github-actions";

export const workflowExists = (workdir: string): boolean =>
  existsSync(join(workdir, DEPLOY_WORKFLOW_PATH));

export const writeWorkflow = async (workdir: string): Promise<string> => {
  const filePath = join(workdir, DEPLOY_WORKFLOW_PATH);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, DEPLOY_WORKFLOW_YAML, "utf8");
  return filePath;
};
