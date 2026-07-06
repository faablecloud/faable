import test from "ava";
import { ensure_dependencies } from "./ensure_dependencies";

// Fake filesystem: a set of existing absolute paths.
const fsWith = (...paths: string[]) => {
  const set = new Set(paths);
  return (p: string) => set.has(p);
};

const capture = () => {
  const calls: { command: string; cwd: string }[] = [];
  const run = async (command: string, cwd: string) => {
    calls.push({ command, cwd });
  };
  return { calls, run };
};

test("no-op when node_modules exists in the workdir", async (t) => {
  const { calls, run } = capture();
  await ensure_dependencies("/repo/app", {
    run,
    exists: fsWith("/repo/app/node_modules"),
  });
  t.deepEqual(calls, []);
});

test("no-op when node_modules is hoisted to a parent within the repo", async (t) => {
  const { calls, run } = capture();
  await ensure_dependencies("/repo/packages/app", {
    run,
    exists: fsWith("/repo/node_modules", "/repo/.git"),
  });
  t.deepEqual(calls, []);
});

test("does not look for node_modules beyond the repo root (.git boundary)", async (t) => {
  const { calls, run } = capture();
  await ensure_dependencies("/home/user/repo", {
    run,
    hasTool: async () => true,
    // node_modules exists ABOVE the repo root — must be ignored.
    exists: fsWith("/home/user/node_modules", "/home/user/repo/.git"),
  });
  t.is(calls.length, 1);
});

test("npm ci when package-lock.json exists", async (t) => {
  const { calls, run } = capture();
  await ensure_dependencies("/repo", {
    run,
    exists: fsWith("/repo/.git", "/repo/package-lock.json"),
  });
  t.deepEqual(calls, [{ command: "npm ci", cwd: "/repo" }]);
});

test("npm ci when npm-shrinkwrap.json exists", async (t) => {
  const { calls, run } = capture();
  await ensure_dependencies("/repo", {
    run,
    exists: fsWith("/repo/.git", "/repo/npm-shrinkwrap.json"),
  });
  t.deepEqual(calls, [{ command: "npm ci", cwd: "/repo" }]);
});

test("yarn install when yarn.lock exists and yarn is available", async (t) => {
  const { calls, run } = capture();
  await ensure_dependencies("/repo", {
    run,
    hasTool: async (name) => name === "yarn",
    exists: fsWith("/repo/.git", "/repo/yarn.lock"),
  });
  t.deepEqual(calls, [
    { command: "yarn install --frozen-lockfile", cwd: "/repo" },
  ]);
});

test("falls back to npm install when yarn.lock exists but yarn is missing", async (t) => {
  const { calls, run } = capture();
  await ensure_dependencies("/repo", {
    run,
    hasTool: async () => false,
    exists: fsWith("/repo/.git", "/repo/yarn.lock"),
  });
  t.deepEqual(calls, [
    { command: "npm install --no-audit --no-fund", cwd: "/repo" },
  ]);
});

test("pnpm install when pnpm-lock.yaml exists and pnpm is available", async (t) => {
  const { calls, run } = capture();
  await ensure_dependencies("/repo", {
    run,
    hasTool: async (name) => name === "pnpm",
    exists: fsWith("/repo/.git", "/repo/pnpm-lock.yaml"),
  });
  t.deepEqual(calls, [
    { command: "pnpm install --frozen-lockfile", cwd: "/repo" },
  ]);
});

test("npm install when there is no lockfile", async (t) => {
  const { calls, run } = capture();
  await ensure_dependencies("/repo", {
    run,
    exists: fsWith("/repo/.git", "/repo/package.json"),
  });
  t.deepEqual(calls, [
    { command: "npm install --no-audit --no-fund", cwd: "/repo" },
  ]);
});
