import test from "ava";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { detect_buildpack } from "./registry";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Synthetic project dirs. Node fixtures deliberately have NO `engines.node`
// so detection resolves the local node version without hitting `npm view`.
const project = (files: Record<string, string>): string => {
  const dir = mkdtempSync(join(tmpdir(), "faable-detect-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, content);
  }
  return dir;
};

const detect = (dir: string, override?: string) =>
  detect_buildpack({ workdir: dir, config: {} }, override);

const PKG = JSON.stringify({ name: "fixture-app", scripts: { start: "node ." } });
const FASTAPI_REQS = "fastapi\nuvicorn\n";
const FASTAPI_MAIN = "app = FastAPI()\n";

test("package.json alone → node", async (t) => {
  const plan = await detect(project({ "package.json": PKG }));
  t.is(plan.buildpack, "node");
  t.is(plan.runtime.name, "node");
  t.truthy(plan.runtime.version);
  t.is(plan.start_command, "npm run start");
  t.is(plan.from, `node:${plan.runtime.version}`);
});

test("node wins over python when both manifests exist", async (t) => {
  const plan = await detect(
    project({ "package.json": PKG, "requirements.txt": FASTAPI_REQS })
  );
  t.is(plan.buildpack, "node");
});

test("each python manifest alone → python with default version", async (t) => {
  for (const manifest of ["requirements.txt", "pyproject.toml", "Pipfile"]) {
    const plan = await detect(
      project({ [manifest]: FASTAPI_REQS, "main.py": FASTAPI_MAIN })
    );
    t.is(plan.buildpack, "python", manifest);
    t.is(plan.runtime.version, "3.11.3", manifest);
    t.is(plan.type, "python", manifest);
  }
});

test("python version comes from runtime.txt first", async (t) => {
  const plan = await detect(
    project({
      "requirements.txt": FASTAPI_REQS,
      "main.py": FASTAPI_MAIN,
      "runtime.txt": "python-3.12.1",
      ".python-version": "3.10.0",
    })
  );
  t.is(plan.runtime.version, "3.12.1");
});

test("python version falls back to .python-version", async (t) => {
  const plan = await detect(
    project({
      "requirements.txt": FASTAPI_REQS,
      "main.py": FASTAPI_MAIN,
      ".python-version": "3.10.4\n",
    })
  );
  t.is(plan.runtime.version, "3.10.4");
});

test("python version read from pyproject requires-python", async (t) => {
  const plan = await detect(
    project({
      "pyproject.toml": `[project]\nrequires-python = ">=3.11"\ndependencies = ["fastapi"]\n`,
      "main.py": FASTAPI_MAIN,
    })
  );
  t.is(plan.runtime.version, "3.11");
});

test("malformed runtime.txt throws", async (t) => {
  await t.throwsAsync(() =>
    detect(
      project({
        "requirements.txt": FASTAPI_REQS,
        "main.py": FASTAPI_MAIN,
        "runtime.txt": "3.12.1",
      })
    )
  );
});

test("Dockerfile alone → docker with null start_command", async (t) => {
  const plan = await detect(project({ Dockerfile: "FROM alpine\n" }));
  t.is(plan.buildpack, "docker");
  t.is(plan.type, "node");
  t.is(plan.start_command, null);
});

test("python manifest wins over Dockerfile", async (t) => {
  const plan = await detect(
    project({
      "requirements.txt": FASTAPI_REQS,
      "main.py": FASTAPI_MAIN,
      Dockerfile: "FROM alpine\n",
    })
  );
  t.is(plan.buildpack, "python");
});

test("python claims the project even when start cannot resolve (no silent fallthrough to docker)", async (t) => {
  await t.throwsAsync(() =>
    detect(
      project({ "requirements.txt": "somelib\n", Dockerfile: "FROM alpine\n" })
    )
  );
});

test("Dockerfile beside a bare main.py → docker (no manifest claims it)", async (t) => {
  const plan = await detect(
    project({ Dockerfile: "FROM python:3.12\n", "main.py": FASTAPI_MAIN })
  );
  t.is(plan.buildpack, "docker");
});

test("empty dir throws", async (t) => {
  await t.throwsAsync(() => detect(project({})));
});

// --- override (--buildpack / faable.json buildpack) ---

test("unknown buildpack override lists the valid names", async (t) => {
  const err = await t.throwsAsync(() =>
    detect(project({ "package.json": PKG }), "bogus")
  );
  t.regex(err!.message, /node, python, docker/);
});

test("forcing a buildpack without its trigger files fails with a targeted error", async (t) => {
  const err = await t.throwsAsync(() =>
    detect(project({ "package.json": PKG }), "docker")
  );
  t.regex(err!.message, /Dockerfile/);
});

test("override forces docker over node and detects next beside the Dockerfile", async (t) => {
  const plan = await detect(
    project({
      Dockerfile: "FROM node:22\n",
      "package.json": JSON.stringify({
        name: "x",
        dependencies: { next: "latest" },
      }),
    }),
    "docker"
  );
  t.is(plan.buildpack, "docker");
  t.is(plan.type, "next");
});

test("faable.json buildpack override is honored via config", async (t) => {
  const dir = project({
    Dockerfile: "FROM node:22\n",
    "package.json": PKG,
  });
  const plan = await detect_buildpack(
    { workdir: dir, config: { buildpack: "docker" } },
    // CLI arg missing → config value applies (wired in the deploy command)
    "docker"
  );
  t.is(plan.buildpack, "docker");
});

// Smoke over the repo's real fixtures. node-express is skipped for node (it
// pins engines.node → would hit `npm view` on the network); nextjs has none.
test("examples smoke: nextjs → node/next, python-fastapi → python, docker-node → docker", async (t) => {
  const examples = join(__dirname, "..", "..", "..", "..", "examples");
  const next_plan = await detect(join(examples, "nextjs"));
  t.is(next_plan.buildpack, "node");
  t.is(next_plan.type, "next");
  const py_plan = await detect_buildpack({
    workdir: join(examples, "python-fastapi"),
    // The fixture's faable.json sets startCommand — emulate it like deploy does.
    config: { startCommand: "uvicorn main:app" },
  });
  t.is(py_plan.buildpack, "python");
  t.is(py_plan.start_command, "uvicorn main:app");
  t.is((await detect(join(examples, "docker-node"))).buildpack, "docker");
});
