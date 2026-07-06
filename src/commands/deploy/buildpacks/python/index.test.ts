import test from "ava";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { python_buildpack } from "./index";

const project = (files: Record<string, string>): string => {
  const dir = mkdtempSync(join(tmpdir(), "faable-pybp-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, content);
  }
  return dir;
};

const detect = (dir: string, config = {}) =>
  python_buildpack.detect({ workdir: dir, config });

test("no manifest → null (not claimed)", async (t) => {
  t.is(await detect(project({ "main.py": "app = FastAPI()\n" })), null);
});

test("requirements provider: cacheable install layer + server injection", async (t) => {
  const plan = await detect(
    project({ "requirements.txt": "fastapi\n", "main.py": "app = FastAPI()\n" })
  );
  t.truthy(plan);
  t.is(plan!.buildpack, "python");
  t.is(plan!.type, "python");
  t.is(
    plan!.install_command,
    "pip install --no-cache-dir -r requirements.txt && pip install --no-cache-dir uvicorn[standard]"
  );
  t.deepEqual(plan!.install_files, ["requirements.txt"]);
  t.is(plan!.start_command, "uvicorn main:app --host 0.0.0.0 --port $PORT");
  t.is(plan!.from, "python:3.11.3");
});

test("pyproject provider: install after COPY (no install_files)", async (t) => {
  const plan = await detect(
    project({
      "pyproject.toml": `[project]\ndependencies = ["flask", "gunicorn"]\n`,
      "app.py": "app = Flask(__name__)\n",
    })
  );
  t.is(plan!.install_command, "pip install --no-cache-dir .");
  t.is(plan!.install_files, undefined);
  t.is(plan!.start_command, "gunicorn app:app --bind 0.0.0.0:$PORT");
});

test("pipfile provider: pipenv system deploy, no install_files", async (t) => {
  const plan = await detect(
    project({ Pipfile: `[packages]\nflask = "*"\ngunicorn = "*"\n`, "app.py": "app = Flask(__name__)\n" })
  );
  t.is(
    plan!.install_command,
    "pip install --no-cache-dir pipenv && pipenv install --system --deploy"
  );
  t.is(plan!.install_files, undefined);
});

test("config buildCommand overrides the provider install and drops the cache layer", async (t) => {
  const plan = await detect(
    project({ "requirements.txt": "flask\ngunicorn\n", "app.py": "app = Flask(__name__)\n" }),
    { buildCommand: "make deps" }
  );
  t.is(plan!.install_command, "make deps");
  t.is(plan!.install_files, undefined);
});

test("manifest present but unresolvable start → claims and throws (no fallthrough)", async (t) => {
  await t.throwsAsync(() =>
    detect(project({ "requirements.txt": "somelib\n" }))
  );
});

// --- detect_fallback: bare entrypoint, no manifest ---

const fallback = (dir: string, config = {}) =>
  python_buildpack.detect_fallback!({ workdir: dir, config });

test("fallback: no entry files → null", async (t) => {
  t.is(await fallback(project({ "util.py": "x = 1\n" })), null);
});

test("fallback: main.py with FastAPI import → uvicorn plan, server injected, no install_files", async (t) => {
  const plan = await fallback(
    project({ "main.py": "from fastapi import FastAPI\napp = FastAPI()\n" })
  );
  t.truthy(plan);
  t.is(plan!.buildpack, "python");
  t.is(plan!.start_command, "uvicorn main:app --host 0.0.0.0 --port $PORT");
  t.is(plan!.install_command, "pip install --no-cache-dir uvicorn[standard]");
  t.is(plan!.install_files, undefined);
});

test("fallback: wsgi.py + Procfile uses the Procfile start", async (t) => {
  const plan = await fallback(
    project({
      "wsgi.py": "application = app\n",
      Procfile: "web: gunicorn wsgi:application --bind 0.0.0.0:$PORT",
    })
  );
  t.is(plan!.start_command, "gunicorn wsgi:application --bind 0.0.0.0:$PORT");
});

test("fallback: unrecognizable entry file → throws with the startCommand hint", async (t) => {
  const err = await t.throwsAsync(() =>
    fallback(project({ "main.py": "def run(): pass\n" }))
  );
  t.regex(err!.message, /startCommand/);
});
