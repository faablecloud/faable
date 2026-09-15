import test from "ava";
import type { AxiosAdapter, InternalAxiosRequestConfig } from "axios";
import { AxiosError } from "axios";
import { CLIENT_ID, CLI_CLIENT, createAnonymousAuthApi, createBearerAuthApi } from "./auth";
import { version } from "../config";

// What the CLI says on the wire, now that it goes through the SDK: its own
// name (not `auth-sdk`), no machine name in the audit log, the user's bearer
// where it belongs — and the device-flow error shape the login loop reads.

const capturing = (reply?: { status: number; data: unknown }) => {
  const seen: InternalAxiosRequestConfig[] = [];
  const adapter: AxiosAdapter = async (config) => {
    seen.push(config as InternalAxiosRequestConfig);
    const res = {
      data: reply?.data ?? {},
      status: reply?.status ?? 200,
      statusText: "",
      headers: {},
      config,
    };
    if (res.status >= 400) {
      throw new AxiosError("bad", "ERR_BAD_REQUEST", config, undefined, res);
    }
    return res;
  };
  return { adapter, seen, header: (i: number, name: string) => (seen[i].headers as Record<string, string>)[name] };
};

test("identifies as faable-cli/<version>, never as auth-sdk", async (t) => {
  const c = capturing();
  await createAnonymousAuthApi({ fetcher: { adapter: c.adapter } }).fetcher.post("/oauth/device/code", { client_id: CLIENT_ID });
  t.is(c.header(0, "x-faable-client"), CLI_CLIENT);
  t.is(CLI_CLIENT, `faable-cli/${version}`);
  t.true(CLI_CLIENT.slice("faable-cli/".length).length <= 32, "auth's budget for the segment");
});

test("sends no x-faable-instance: the user's hostname stays off our audit log", async (t) => {
  const c = capturing();
  await createAnonymousAuthApi({ fetcher: { adapter: c.adapter } }).fetcher.post("/oauth/token", { a: 1 });
  t.is(c.header(0, "x-faable-instance"), undefined);
});

test("the bearer client sends the user's token and the tenant scope", async (t) => {
  const c = capturing();
  const api = createBearerAuthApi(() => "user-token", {
    account: "account_1",
    fetcher: { adapter: c.adapter },
  });
  await api.fetcher.get("/me");
  t.is(c.header(0, "authorization"), "Bearer user-token");
  t.is(c.header(0, "x-faableauth-account"), "account_1");
  t.is(c.header(0, "x-faable-client"), CLI_CLIENT);
});

test("a device-flow error keeps the OAuth body where the login loop reads it, and is not retried", async (t) => {
  const c = capturing({ status: 400, data: { error: "authorization_pending" } });
  const api = createAnonymousAuthApi({ fetcher: { adapter: c.adapter } });
  const err = await t.throwsAsync(api.fetcher.post("/oauth/token", { device_code: "d" }));
  const body = (err as { response?: { data?: { error?: string } } }).response?.data;
  t.is(body?.error, "authorization_pending");
  t.is(c.seen.length, 1, "a POST is never replayed — every pending poll would double");
});
