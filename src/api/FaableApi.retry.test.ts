import test from "ava";
import { AxiosError, AxiosRequestConfig, AxiosResponse } from "axios";
import { FaableApi } from "./FaableApi";

// Drives the client through a fake adapter: no sockets involved, the
// interceptor chain (retry + error wrapping) runs exactly as in production.
const with_adapter = (
  api: FaableApi,
  handler: (config: AxiosRequestConfig, call: number) => AxiosResponse["data"]
) => {
  let calls = 0;
  api.client.defaults.adapter = async (config) => {
    calls += 1;
    const data = handler(config, calls);
    return {
      data,
      status: 200,
      statusText: "OK",
      headers: {},
      config,
    } as AxiosResponse;
  };
  return () => calls;
};

const reset_error = (config: AxiosRequestConfig, code = "ECONNRESET") =>
  new AxiosError(`read ${code}`, code, config as never);

test("retries once when the connection is reset before a response", async (t) => {
  const api = FaableApi.create();
  const calls = with_adapter(api, (config, call) => {
    if (call === 1) throw reset_error(config);
    return { ok: true };
  });

  const res = await api.client.post("/upload/missing", {});
  t.is(calls(), 2);
  t.deepEqual(res.data, { ok: true });
});

test("gives up after the second reset and surfaces the wrapped error", async (t) => {
  const api = FaableApi.create();
  const calls = with_adapter(api, (config) => {
    throw reset_error(config);
  });

  await t.throwsAsync(() => api.client.post("/deployment", {}), {
    message: /ECONNRESET/,
  });
  t.is(calls(), 2);
});

test("does not retry when the server answered with an error status", async (t) => {
  const api = FaableApi.create();
  let calls = 0;
  api.client.defaults.adapter = async (config) => {
    calls += 1;
    const response = {
      data: { message: "boom" },
      status: 500,
      statusText: "Internal Server Error",
      headers: {},
      config,
    } as AxiosResponse;
    throw new AxiosError(
      "Request failed with status code 500",
      "ERR_BAD_RESPONSE",
      config as never,
      undefined,
      response
    );
  };

  await t.throwsAsync(() => api.client.post("/deployment", {}), {
    message: /500: boom/,
  });
  t.is(calls, 1);
});

test("does not retry non-reset network errors", async (t) => {
  const api = FaableApi.create();
  let calls = 0;
  api.client.defaults.adapter = async (config) => {
    calls += 1;
    throw new AxiosError("timeout of 10000ms exceeded", "ECONNABORTED", config as never);
  };

  await t.throwsAsync(() => api.client.get("/app"), {
    message: /timeout/,
  });
  t.is(calls, 1);
});
