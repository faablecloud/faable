import test from "ava";
import { AxiosRequestConfig, AxiosResponse } from "axios";
import { FaableApi } from "./FaableApi";

// Same fake-adapter technique as FaableApi.retry.test.ts: no sockets, the
// full interceptor chain runs as in production.
const with_adapter = (
  api: FaableApi,
  handler: (config: AxiosRequestConfig, call: number) => AxiosResponse["data"]
) => {
  const seen: AxiosRequestConfig[] = [];
  api.client.defaults.adapter = async (config) => {
    seen.push(config);
    return {
      data: handler(config, seen.length),
      status: 200,
      statusText: "OK",
      headers: {},
      config,
    } as AxiosResponse;
  };
  return seen;
};

const app = (id: string, repository?: string) => ({
  id,
  name: id,
  repository,
});

test("list() walks every page of GET /app, not just the first", async (t) => {
  const api = FaableApi.create();
  const seen = with_adapter(api, (config) => {
    // Cursor chain: (no next) -> c2 -> c3 -> end
    switch (config.params?.next) {
      case undefined:
        return { results: [app("app_1"), app("app_2")], next: "c2" };
      case "c2":
        return { results: [app("app_3")], next: "c3" };
      case "c3":
        return { results: [app("app_4", "kirbic/print-art.es")], next: null };
      default:
        throw new Error(`unexpected cursor ${config.params?.next}`);
    }
  });

  const apps = await api.list();

  t.is(seen.length, 3);
  // Every request asks for the biggest page the API allows
  t.true(seen.every((c) => c.params?.pageSize === 200));
  t.deepEqual(
    apps.map((a) => a.id),
    ["app_1", "app_2", "app_3", "app_4"]
  );
  // The app on the last page is reachable (the original bug: an app beyond
  // page 1 never matched the repository lookup)
  t.truthy(apps.find((a) => a.repository === "kirbic/print-art.es"));
});

test("list() stops on the first page when next is null", async (t) => {
  const api = FaableApi.create();
  const seen = with_adapter(api, () => ({
    results: [app("app_1")],
    next: null,
  }));

  const apps = await api.list();
  t.is(seen.length, 1);
  t.is(apps.length, 1);
});
