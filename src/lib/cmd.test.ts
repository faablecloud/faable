import test from "ava";
import { cmd } from "./cmd";
import { buildLog } from "./log_buffer";

test("cmd git", async (t) => {
  await cmd("git --version");
  t.pass();
});

// cmd() pipes all subprocess output into the shared build-log buffer;
// enableOutput only controls mirroring to the terminal, not capture.

test.serial("captures stdout into buildLog with enableOutput", async (t) => {
  buildLog.reset();
  await cmd("echo captured-with-output", { enableOutput: true });
  t.true(buildLog.contents().content.includes("captured-with-output"));
});

test.serial("captures stdout into buildLog without enableOutput", async (t) => {
  buildLog.reset();
  await cmd("echo captured-silently");
  t.true(buildLog.contents().content.includes("captured-silently"));
});

test.serial("captures stderr into buildLog", async (t) => {
  buildLog.reset();
  await cmd("echo to-stderr 1>&2");
  t.true(buildLog.contents().content.includes("to-stderr"));
});

test.serial("failing command still throws with its output", async (t) => {
  buildLog.reset();
  const error = await t.throwsAsync(() => cmd("echo boom-output && exit 3"));
  t.regex(error!.message, /Command error:/);
  t.true(buildLog.contents().content.includes("boom-output"));
});

test.serial("large output does not kill the child (maxBuffer)", async (t) => {
  buildLog.reset();
  // 1MB of output — over promisify-child-process's 200KB default maxBuffer.
  await t.notThrowsAsync(() => cmd("head -c 1048576 /dev/zero | tr '\\0' 'x'"));
});
