import test from "ava";
import { propose_release } from "./release_version";

test("explicit --release wins and is never validated", async (t) => {
  const got = await propose_release({
    explicit: "banana-phone",
    env: { FAABLE_RELEASE: "9.9.9" },
    run: async () => {
      throw new Error("git should not be consulted with an explicit release");
    },
  });
  t.deepEqual(got, { release: "banana-phone", source: "--release" });
});

test("FAABLE_RELEASE env wins over git", async (t) => {
  const got = await propose_release({
    env: { FAABLE_RELEASE: "2.0.0-rc.1" },
    run: async () => {
      throw new Error("git should not be consulted when the env var is set");
    },
  });
  t.deepEqual(got, { release: "2.0.0-rc.1", source: "FAABLE_RELEASE env" });
});

test("falls back to the latest v-prefixed git tag, stripped", async (t) => {
  const got = await propose_release({
    env: {},
    run: async (command) =>
      command.includes('--match "v[0-9]*"') ? "v1.31.0" : undefined,
  });
  t.deepEqual(got, { release: "1.31.0", source: "git tag v1.31.0" });
});

test("retries without --match for unprefixed release tags", async (t) => {
  const got = await propose_release({
    env: {},
    run: async (command) =>
      command.includes("--match") ? undefined : "3.2.1",
  });
  t.deepEqual(got, { release: "3.2.1", source: "git tag 3.2.1" });
});

test("non-version tags are rejected → undefined", async (t) => {
  const got = await propose_release({
    env: {},
    run: async (command) =>
      command.includes("--match") ? undefined : "nightly",
  });
  t.is(got, undefined);
});

test("no git repo / no tags → undefined (deploy proceeds without release)", async (t) => {
  const got = await propose_release({ env: {}, run: async () => undefined });
  t.is(got, undefined);
});
