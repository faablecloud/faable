import test from "ava";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { createRequire } from "module";
import { tmpdir } from "os";
import path from "path";
import { pathToFileURL } from "url";
import { wrap_next_config } from "./wrap_next_config";

process.env.FAABLE_DEPLOY_ID = "dep_test123";
const ENV = { FAABLE_DEPLOY_ID: "dep_test123" };

const project = (files: Record<string, string>) => {
  const dir = mkdtempSync(path.join(tmpdir(), "faable-wrap-"));
  writeFileSync(path.join(dir, "package.json"), files["package.json"] ?? "{}");
  for (const [name, content] of Object.entries(files)) {
    if (name === "package.json") continue;
    writeFileSync(path.join(dir, name), content);
  }
  return dir;
};

const requireWrapper = (dir: string) =>
  createRequire(path.join(dir, "noop.js"))(path.join(dir, "next.config.js"));

test("object config (CJS): buildId added, user's config preserved", async (t) => {
  const dir = project({
    "next.config.js": "module.exports = { reactStrictMode: true };",
  });
  const wrapped = await wrap_next_config(dir, ENV);
  t.truthy(wrapped);
  t.true(existsSync(path.join(dir, "next.config.faable-original.js")));

  const config = await requireWrapper(dir)("phase-test", {});
  t.true(config.reactStrictMode);
  t.is(config.generateBuildId(), "dep_test123");

  await wrapped!.restore();
  t.false(existsSync(path.join(dir, "next.config.faable-original.js")));
  t.is(
    readFileSync(path.join(dir, "next.config.js"), "utf8"),
    "module.exports = { reactStrictMode: true };"
  );
});

test("user-defined generateBuildId is never overridden", async (t) => {
  const dir = project({
    "next.config.js":
      "module.exports = { generateBuildId: () => 'user-owned' };",
  });
  const wrapped = await wrap_next_config(dir, ENV);
  const config = await requireWrapper(dir)("phase", {});
  t.is(config.generateBuildId(), "user-owned");
  await wrapped!.restore();
});

test("function config (CJS): phase threading + buildId", async (t) => {
  const dir = project({
    "next.config.js": "module.exports = (phase) => ({ phase });",
  });
  const wrapped = await wrap_next_config(dir, ENV);
  const config = await requireWrapper(dir)("the-phase", {});
  t.is(config.phase, "the-phase");
  t.is(config.generateBuildId(), "dep_test123");
  await wrapped!.restore();
});

test("async function config resolves before composing", async (t) => {
  const dir = project({
    "next.config.js": "module.exports = async () => ({ swcMinify: true });",
  });
  const wrapped = await wrap_next_config(dir, ENV);
  const config = await requireWrapper(dir)("phase", {});
  t.true(config.swcMinify);
  t.is(config.generateBuildId(), "dep_test123");
  await wrapped!.restore();
});

test("ESM config (.mjs): wrapper is ESM and composes", async (t) => {
  const dir = project({
    "next.config.mjs": "export default { trailingSlash: true };",
  });
  const wrapped = await wrap_next_config(dir, ENV);
  const mod = await import(
    pathToFileURL(path.join(dir, "next.config.mjs")).href
  );
  const config = await mod.default("phase", {});
  t.true(config.trailingSlash);
  t.is(config.generateBuildId(), "dep_test123");
  await wrapped!.restore();
  t.is(
    readFileSync(path.join(dir, "next.config.mjs"), "utf8"),
    "export default { trailingSlash: true };"
  );
});

test('package.json type=module: .js config gets an ESM wrapper', async (t) => {
  const dir = project({
    "package.json": '{ "type": "module" }',
    "next.config.js": "export default { compress: false };",
  });
  const wrapped = await wrap_next_config(dir, ENV);
  const wrapper = readFileSync(path.join(dir, "next.config.js"), "utf8");
  t.true(wrapper.includes("export default"));
  t.false(wrapper.includes("module.exports"));
  await wrapped!.restore();
});

test("no next.config at all: standalone wrapper, restore removes it", async (t) => {
  const dir = project({});
  const wrapped = await wrap_next_config(dir, ENV);
  t.truthy(wrapped);
  const mod = await import(
    pathToFileURL(path.join(dir, "next.config.mjs")).href
  );
  const config = await mod.default("phase", {});
  t.is(config.generateBuildId(), "dep_test123");
  await wrapped!.restore();
  t.false(existsSync(path.join(dir, "next.config.mjs")));
});

test("next.config.ts: skipped with no mutation", async (t) => {
  const dir = project({ "next.config.ts": "export default {};" });
  t.is(await wrap_next_config(dir, ENV), null);
  t.is(
    readFileSync(path.join(dir, "next.config.ts"), "utf8"),
    "export default {};"
  );
});

test("without FAABLE_DEPLOY_ID in the build env: no-op", async (t) => {
  const dir = project({ "next.config.js": "module.exports = {};" });
  t.is(await wrap_next_config(dir, {}), null);
  t.false(existsSync(path.join(dir, "next.config.faable-original.js")));
});

test("restore is idempotent", async (t) => {
  const dir = project({ "next.config.js": "module.exports = {};" });
  const wrapped = await wrap_next_config(dir, ENV);
  await wrapped!.restore();
  await t.notThrowsAsync(() => wrapped!.restore());
  t.is(
    readFileSync(path.join(dir, "next.config.js"), "utf8"),
    "module.exports = {};"
  );
});
