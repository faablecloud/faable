import test from "ava";
import { buildLog } from "../../lib/log_buffer";
import { mark_build_failure, start_log_sync, upload_logs } from "./upload_logs";

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
  "mark_build_failure flips the existing deployment to BUILD_ERROR with logs — no new row",
  async (t) => {
    buildLog.reset();
    buildLog.append("error TS2322: kaboom\n");
    const calls: any = { create: null, status: null, logs: null };
    const api: any = {
      createDeployment: async () => {
        calls.create = true;
        return { id: "never" };
      },
      updateDeploymentStatus: async (id: string, status: any) => {
        calls.status = { id, status };
      },
      uploadDeploymentLogs: async (id: string, body: any) => {
        calls.logs = { id, body };
        return { id: "log_1", truncated: false, size: 0 };
      },
    };
    await mark_build_failure(api, {
      deployment_id: "deployment_existing",
      app: { id: "app_x", team: "team_x" },
    });
    // Create-first: the failure is recorded on the pre-created row. Creating
    // a second deployment here would burn quota (the old flow's double-429).
    t.is(calls.create, null);
    t.deepEqual(calls.status, {
      id: "deployment_existing",
      status: { phase: "BUILD_ERROR" },
    });
    t.is(calls.logs.id, "deployment_existing");
    t.true(calls.logs.body.content.includes("kaboom"));
  }
);

test.serial("mark_build_failure never rejects", async (t) => {
  buildLog.reset();
  buildLog.append("boom\n");
  const api: any = {
    updateDeploymentStatus: () => Promise.reject(new Error("api down")),
    uploadDeploymentLogs: () => Promise.reject(new Error("api down")),
  };
  await t.notThrowsAsync(() =>
    mark_build_failure(api, {
      deployment_id: "deployment_x",
      app: { id: "app_x", team: "team_x" },
    })
  );
});

test.serial(
  "start_log_sync re-uploads while the buffer grows, skips when idle, and stops cleanly",
  async (t) => {
    buildLog.reset();
    const uploads: any[] = [];
    const api: any = {
      uploadDeploymentLogs: async (_id: string, body: any) => {
        uploads.push(body.content);
        return { id: "log_1", truncated: false, size: 0 };
      },
    };
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

    const stop = start_log_sync(api, "deployment_x", 20);
    buildLog.append("step 1\n");
    await wait(50);
    t.is(uploads.length, 1);

    // No growth → no re-upload.
    await wait(50);
    t.is(uploads.length, 1);

    buildLog.append("step 2\n");
    await wait(50);
    t.is(uploads.length, 2);
    t.true(uploads[1].includes("step 2"));

    stop();
    buildLog.append("after stop\n");
    await wait(50);
    t.is(uploads.length, 2);
  }
);
