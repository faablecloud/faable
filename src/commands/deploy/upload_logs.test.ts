import test from "ava";
import { buildLog } from "../../lib/log_buffer";
import { report_build_failure, upload_logs } from "./upload_logs";

// Both helpers are best-effort: an API failure must never reject (a broken
// log upload must not fail an otherwise-good deploy, and the failure path
// must not mask the original build error).

test.serial("upload_logs resolves even when the API rejects", async (t) => {
  buildLog.reset();
  buildLog.append("some build output\n");
  const api: any = {
    uploadDeploymentLogs: () => Promise.reject(new Error("404 Not Found")),
  };
  await t.notThrowsAsync(() => upload_logs(api, "deployment_x"));
});

test.serial("upload_logs skips the call when there is no output", async (t) => {
  buildLog.reset();
  let called = false;
  const api: any = {
    uploadDeploymentLogs: async () => {
      called = true;
    },
  };
  await upload_logs(api, "deployment_x");
  t.false(called);
});

test.serial("upload_logs sends the captured content", async (t) => {
  buildLog.reset();
  buildLog.append("npm ci\nbuild ok\n");
  let sent: any = null;
  const api: any = {
    uploadDeploymentLogs: async (_id: string, body: any) => {
      sent = body;
      return { id: "log_1", truncated: false, size: 0 };
    },
  };
  await upload_logs(api, "deployment_x");
  t.truthy(sent);
  t.true(sent.content.includes("build ok"));
  t.false(sent.truncated);
});

test.serial(
  "report_build_failure creates an image-less BUILD_ERROR deployment",
  async (t) => {
    buildLog.reset();
    buildLog.append("error TS2322: kaboom\n");
    const calls: any = { create: null, status: null, logs: null };
    const api: any = {
      createDeployment: async (params: any) => {
        calls.create = params;
        return { id: "deployment_failed" };
      },
      updateDeploymentStatus: async (id: string, status: any) => {
        calls.status = { id, status };
      },
      uploadDeploymentLogs: async (id: string, body: any) => {
        calls.logs = { id, body };
        return { id: "log_1", truncated: false, size: 0 };
      },
    };
    await report_build_failure(api, {
      app: { id: "app_x", team: "team_x" },
      workdir: process.cwd(),
    });
    t.is(calls.create.app_id, "app_x");
    t.is(calls.create.image, undefined);
    t.is(calls.create.type, undefined);
    t.deepEqual(calls.status, {
      id: "deployment_failed",
      status: { phase: "BUILD_ERROR" },
    });
    t.is(calls.logs.id, "deployment_failed");
    t.true(calls.logs.body.content.includes("kaboom"));
  }
);

test.serial("report_build_failure never rejects", async (t) => {
  buildLog.reset();
  const api: any = {
    createDeployment: () => Promise.reject(new Error("api down")),
  };
  await t.notThrowsAsync(() =>
    report_build_failure(api, {
      app: { id: "app_x", team: "team_x" },
      workdir: process.cwd(),
    })
  );
});
