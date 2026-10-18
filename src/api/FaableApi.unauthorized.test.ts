import test from "ava";
import { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from "axios";
import { FaableApi, is_credential_error } from "./FaableApi";

// Only a dead credential is "log in again". The api also answers 401 to a
// valid one that may not do this, and telling that caller to run
// `faable login` sent them in circles (backlog §374).

const answering = (api: FaableApi, body: Record<string, unknown>) => {
  api.client.defaults.adapter = async (config) => {
    const response = {
      data: body,
      status: 401,
      statusText: "Unauthorized",
      headers: {},
      config: config as InternalAxiosRequestConfig,
    } as AxiosResponse;
    throw new AxiosError(
      "401",
      "ERR_BAD_REQUEST",
      config as InternalAxiosRequestConfig,
      undefined,
      response,
    );
  };
};

const failure = async (body: Record<string, unknown>) => {
  const api = FaableApi.create();
  answering(api, body);
  try {
    await api.listApps({});
  } catch (e) {
    return e as Error & { code?: string; status?: number };
  }
  throw new Error("expected a 401");
};

test("a dead credential still means `faable login`", async (t) => {
  for (const code of ["invalid_token", "unauthorized", undefined]) {
    const e = await failure(
      code ? { error_code: code, code, message: "x" } : { message: "x" },
    );
    t.is(e.code, "session_expired", String(code));
    t.regex(e.message, /faable login/);
  }
});

test("a permission 401 keeps the api's code and message", async (t) => {
  const e = await failure({
    error_code: "team_or_scope_required",
    code: "team_or_scope_required",
    message: "Cannot query apps without a team or app:list scope",
  });
  t.is(e.code, "team_or_scope_required");
  t.is(e.status, 401);
  t.regex(e.message, /Cannot query apps without a team/);
  t.notRegex(e.message, /faable login/);
});

test("is_credential_error", (t) => {
  t.true(is_credential_error(undefined));
  t.true(is_credential_error("invalid_apikey"));
  t.true(is_credential_error("apikey_expired"));
  t.false(is_credential_error("secrets_access_denied"));
  t.false(is_credential_error("team_or_scope_required"));
});
