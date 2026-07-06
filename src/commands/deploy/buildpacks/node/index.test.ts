import test from "ava";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { node_buildpack } from "./index";

// Fixtures have NO `engines.node` so version resolution stays local
// (`node --version`) instead of hitting `npm view` on the network.
const project = (pkg: object): string => {
  const dir = mkdtempSync(join(tmpdir(), "faable-nodebp-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify(pkg));
  return dir;
};

const detect = (dir: string, config = {}) =>
  node_buildpack.detect({ workdir: dir, config });

test("no package.json → null (not claimed)", async (t) => {
  t.is(
    await node_buildpack.detect({
      workdir: mkdtempSync(join(tmpdir(), "faable-nodebp-")),
      config: {},
    }),
    null
  );
});

test("plain node app: default start, no build script", async (t) => {
  const plan = await detect(
    project({ name: "api", scripts: { start: "node server.js" } })
  );
  t.is(plan!.buildpack, "node");
  t.is(plan!.type, "node");
  t.is(plan!.start_command, "npm run start");
  t.is(plan!.build_script, null);
  t.false(plan!.inject_serve);
  t.is(plan!.from, `node:${plan!.runtime.version}`);
});

test("vite app without start script serves the build output", async (t) => {
  const plan = await detect(
    project({
      name: "web",
      scripts: { build: "vite build" },
      devDependencies: { vite: "^5" },
    })
  );
  t.is(plan!.type, "vite");
  t.is(plan!.start_command, "npx vite preview --host 0.0.0.0 --port $PORT");
  t.is(plan!.build_script, "build");
});

test("next app emits type=next (PVC contract) and keeps its own start", async (t) => {
  const plan = await detect(
    project({
      name: "site",
      scripts: { build: "next build", start: "next start" },
      dependencies: { next: "latest" },
    })
  );
  t.is(plan!.type, "next");
  t.is(plan!.start_command, "npm run start");
});

test("config startCommand wins over framework detection", async (t) => {
  const plan = await detect(
    project({ name: "web", devDependencies: { vite: "^5" } }),
    { startCommand: "node custom-server.js" }
  );
  t.is(plan!.start_command, "node custom-server.js");
});

test("package.json without name throws (claimed project)", async (t) => {
  await t.throwsAsync(() => detect(project({ scripts: { start: "node ." } })), {
    message: /Missing name/,
  });
});
