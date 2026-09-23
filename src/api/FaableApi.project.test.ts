import test from "ava";
import { AxiosRequestConfig, AxiosResponse } from "axios";
import { FaableApi, projectHeader } from "./FaableApi";

// The tenant travels as `x-faable-project: project_<hex>`. The app row still
// says `team_<hex>` (same hex), and `x-faable-team` is deprecated: the api
// answers 400 when both headers come in and disagree, so we never send it.

const HEX = "6a8ebd616d2f4b0012345678";
const TEAM = `team_${HEX}`;
const PROJECT = `project_${HEX}`;

const capture = (api: FaableApi) => {
  const seen: AxiosRequestConfig[] = [];
  api.client.defaults.adapter = async (config) => {
    seen.push(config);
    const results = config.method === "get" && !/\/domain\/./.test(config.url ?? "");
    return {
      data: results ? { results: [], next: null } : {},
      status: 200,
      statusText: "OK",
      headers: {},
      config,
    } as AxiosResponse;
  };
  return seen;
};

const header = (c: AxiosRequestConfig, name: string) =>
  (c.headers as Record<string, unknown> | undefined)?.[name];

test("projectHeader maps team_<hex> to project_<hex>", (t) => {
  t.deepEqual(projectHeader(TEAM), { "x-faable-project": PROJECT });
  // Already a project id: left alone.
  t.deepEqual(projectHeader(PROJECT), { "x-faable-project": PROJECT });
});

const calls: [string, (api: FaableApi) => Promise<unknown>][] = [
  ["createSecretsBatch", (api) => api.createSecretsBatch("app_1", TEAM, [])],
  ["listDeployments", (api) => api.listDeployments("app_1", TEAM)],
  ["redeployDeployment", (api) => api.redeployDeployment("deployment_1", TEAM)],
  ["cancelDeployment", (api) => api.cancelDeployment("deployment_1", TEAM)],
  ["listDomains", (api) => api.listDomains("app_1", TEAM)],
  ["createDomain", (api) => api.createDomain(TEAM, { fqdn: "a.example.com", app_id: "app_1" })],
  ["getDomain", (api) => api.getDomain("domain_1", TEAM)],
  ["deleteDomain", (api) => api.deleteDomain("domain_1", TEAM)],
];

for (const [name, call] of calls) {
  test(`${name} sends x-faable-project (project_ form) and never x-faable-team`, async (t) => {
    const api = FaableApi.create();
    const seen = capture(api);
    await call(api);
    t.is(seen.length, 1);
    t.is(header(seen[0], "x-faable-project"), PROJECT);
    t.is(header(seen[0], "x-faable-team"), undefined);
  });
}
