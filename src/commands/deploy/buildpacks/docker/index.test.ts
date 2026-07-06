import test from "ava";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { docker_buildpack } from "./index";

const project = (files: Record<string, string>): string => {
  const dir = mkdtempSync(join(tmpdir(), "faable-dockerbp-"));
  for (const [rel, content] of Object.entries(files)) {
    writeFileSync(join(dir, rel), content);
  }
  return dir;
};

const detect = (dir: string) =>
  docker_buildpack.detect({ workdir: dir, config: {} });

test("no Dockerfile → null (not claimed)", async (t) => {
  t.is(await detect(project({})), null);
});

test("Dockerfile alone → type node, image CMD rules (null start)", async (t) => {
  const plan = await detect(project({ Dockerfile: "FROM alpine\n" }));
  t.is(plan!.buildpack, "docker");
  t.is(plan!.type, "node");
  t.is(plan!.start_command, null);
  t.is(plan!.from, undefined);
});

test("package.json with next beside the Dockerfile → type next", async (t) => {
  const plan = await detect(
    project({
      Dockerfile: "FROM node:22\n",
      "package.json": JSON.stringify({ name: "x", dependencies: { next: "14" } }),
    })
  );
  t.is(plan!.type, "next");
});

test("package.json without next stays type node", async (t) => {
  const plan = await detect(
    project({
      Dockerfile: "FROM node:22\n",
      "package.json": JSON.stringify({ name: "x", dependencies: { express: "4" } }),
    })
  );
  t.is(plan!.type, "node");
});
