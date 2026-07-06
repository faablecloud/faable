import test from "ava";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { DetectError } from "./DetectError";
import { detect_buildpack } from "./registry";

const project = (files: Record<string, string>, dirs: string[] = []): string => {
  const dir = mkdtempSync(join(tmpdir(), "faable-deterr-"));
  for (const d of dirs) mkdirSync(join(dir, d), { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    writeFileSync(join(dir, rel), content);
  }
  return dir;
};

const detect_error = async (dir: string): Promise<DetectError> => {
  try {
    await detect_buildpack({ workdir: dir, config: {} });
  } catch (error) {
    if (error instanceof DetectError) return error;
    throw error;
  }
  throw new Error("expected detection to fail");
};

test("lists every buildpack with its trigger files, strong and fallback", async (t) => {
  const err = await detect_error(project({ "README.md": "# hi" }));
  t.is(err.name, "DetectError");
  t.regex(err.message, /node\s+→ package\.json/);
  t.regex(err.message, /python\s+→ requirements\.txt, pyproject\.toml, Pipfile, cerebrium\.toml/);
  t.regex(err.message, /python \(fallback\)\s+→ main\.py, app\.py, wsgi\.py/);
  t.regex(err.message, /docker\s+→ Dockerfile/);
});

test("lists the files found in the workdir (dirs suffixed, noise skipped)", async (t) => {
  const err = await detect_error(
    project({ "README.md": "# hi", "config.yaml": "x: 1" }, ["src", "node_modules"])
  );
  t.regex(err.message, /README\.md/);
  t.regex(err.message, /src\//);
  t.false(err.message.includes("node_modules"));
  t.deepEqual(err.found_files, ["README.md", "config.yaml", "src/"]);
});

test("recognizes foreign platform configs by name", async (t) => {
  const err = await detect_error(project({ "fly.toml": "[build]\n" }));
  t.regex(err.message, /fly\.toml → Fly\.io/);
  t.deepEqual(err.foreign, [{ file: "fly.toml", platform: "Fly.io" }]);
});

test("points to the override and the docs", async (t) => {
  const err = await detect_error(project({}));
  t.regex(err.message, /--buildpack/);
  t.regex(err.message, /faable\.com\/docs\/deploy\/build-requirements/);
});

test("empty dir reports no files found", async (t) => {
  const err = await detect_error(project({}));
  t.regex(err.message, /No files found/);
});
