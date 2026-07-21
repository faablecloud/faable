import test from "ava";
import { execSync } from "child_process";
import { createHash } from "crypto";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { collect_manifest } from "./manifest";

const git_fixture = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "faable-manifest-"));
  execSync("git init -q", { cwd: dir });
  writeFileSync(join(dir, "package.json"), `{"name":"x"}`);
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src/index.js"), "console.log(1)\n");
  writeFileSync(join(dir, ".gitignore"), "node_modules\n.secret\n");
  // Ignored content must never reach the manifest.
  mkdirSync(join(dir, "node_modules/junk"), { recursive: true });
  writeFileSync(join(dir, "node_modules/junk/a.js"), "junk");
  writeFileSync(join(dir, ".secret"), "token");
  execSync("git add -A && git -c user.email=t@t -c user.name=t commit -qm x", {
    cwd: dir,
  });
  // Untracked but not ignored: included (like a fresh clone + new file).
  writeFileSync(join(dir, "new-file.txt"), "hello");
  return dir;
};

test("collects tracked + untracked files, honoring .gitignore", async (t) => {
  const dir = git_fixture();
  const manifest = await collect_manifest(dir);
  const paths = manifest.map((f) => f.path).sort();
  t.deepEqual(paths, [
    ".gitignore",
    "new-file.txt",
    "package.json",
    "src/index.js",
  ]);

  const entry = manifest.find((f) => f.path === "src/index.js")!;
  t.is(
    entry.sha,
    createHash("sha256").update("console.log(1)\n").digest("hex")
  );
  t.is(entry.size, "console.log(1)\n".length);
  t.is(typeof entry.mode, "number");
});

test("symlinks are rejected with an actionable error", async (t) => {
  const dir = git_fixture();
  symlinkSync("src/index.js", join(dir, "link.js"));
  await t.throwsAsync(() => collect_manifest(dir), {
    message: /Symlinks are not supported/s,
  });
});

test("a non-git directory is rejected", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "faable-nogit-"));
  writeFileSync(join(dir, "package.json"), "{}");
  await t.throwsAsync(() => collect_manifest(dir), {
    message: /git repository/s,
  });
});
