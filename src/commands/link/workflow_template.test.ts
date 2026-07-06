import test from "ava";
import { DEPLOY_WORKFLOW_YAML } from "./workflow_template";

// The same template ships in the API and dashboard repos (no shared package).
// This exact-string test guards against drift between the copies — if it
// changes here, change it there too.
test("deploy workflow is language-agnostic and matches the canonical template", (t) => {
  t.is(
    DEPLOY_WORKFLOW_YAML,
    `name: Deploy to Faable
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
`
  );
  t.false(DEPLOY_WORKFLOW_YAML.includes("npm ci"));
});
