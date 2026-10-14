import test from "ava";
import { UpgradeDeps, upgradeTo } from "./self_upgrade";

// A fake npm: `install` answers from a script, `installed` reports what the
// last successful install left behind.
const fakeNpm = (
  script: Array<{ ok: boolean; output?: string; leaves?: string }>,
  start = "4.8.0"
) => {
  let current = start;
  const asked: string[] = [];
  const deps: UpgradeDeps = {
    install: async (v) => {
      asked.push(v);
      const step = script.shift() ?? { ok: true };
      if (step.ok && step.leaves) current = step.leaves;
      return { ok: step.ok, output: step.output ?? "" };
    },
    installed: async () => current,
    sleep: async () => {},
  };
  return { deps, asked };
};

test("installs the exact version, never @latest", async (t) => {
  const { deps, asked } = fakeNpm([{ ok: true, leaves: "4.9.0" }]);
  t.deepEqual(await upgradeTo("4.9.0", deps), { ok: true, attempts: 1 });
  t.deepEqual(asked, ["4.9.0"]);
});

// The bug: npm exits 0 and the old version is still there.
test("a success that leaves the old version is not a success", async (t) => {
  const { deps } = fakeNpm([
    { ok: true, leaves: "4.8.0" },
    { ok: true, leaves: "4.8.0" },
  ]);
  const res = await upgradeTo("4.9.0", deps, { attempts: 2 });
  t.false(res.ok);
  t.like(res, { reason: "not_propagated", installed: "4.8.0" });
});

test("a stale registry edge (ETARGET) is retried until it catches up", async (t) => {
  const retries: number[] = [];
  const { deps } = fakeNpm([
    { ok: false, output: "npm error code ETARGET\nnpm error notarget No matching version found" },
    { ok: false, output: "npm error code ETARGET" },
    { ok: true, leaves: "4.9.0" },
  ]);
  const res = await upgradeTo("4.9.0", deps, { onRetry: (n) => retries.push(n) });
  t.deepEqual(res, { ok: true, attempts: 3 });
  t.deepEqual(retries, [1, 2]);
});

test("any other npm failure stops at once (permissions, network…)", async (t) => {
  const { deps, asked } = fakeNpm([{ ok: false, output: "npm error code EACCES" }]);
  const res = await upgradeTo("4.9.0", deps);
  t.like(res, { ok: false, reason: "install_failed" });
  t.is(asked.length, 1);
});

test("gives up after the attempts and says which version is installed", async (t) => {
  const { deps, asked } = fakeNpm(
    Array.from({ length: 5 }, () => ({ ok: false, output: "ETARGET" }))
  );
  const res = await upgradeTo("4.9.0", deps);
  t.like(res, { ok: false, reason: "not_propagated", installed: "4.8.0" });
  t.is(asked.length, 5);
});
