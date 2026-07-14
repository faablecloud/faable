import test from "ava";
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  read_dependencies_text,
  resolve_start,
  with_server_injection,
} from "./resolve_start";

const NO_CONFIG = {};

const project = (files: Record<string, string>): string => {
  const dir = mkdtempSync(join(tmpdir(), "faable-py-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, content);
  }
  return dir;
};

// --- resolve_start precedence ---

test("config startCommand wins over everything", (t) => {
  const dir = project({ Procfile: "web: gunicorn other:app" });
  const r = resolve_start(dir, "flask", { startCommand: "uvicorn api:app" });
  t.is(r.start_command, "uvicorn api:app");
  t.is(r.server, "uvicorn");
});

test("Procfile web: line beats the provider hint", (t) => {
  const dir = project({ Procfile: "web: gunicorn app:app --bind 0.0.0.0:$PORT" });
  const r = resolve_start(dir, "", NO_CONFIG, "python custom.py");
  t.is(r.start_command, "gunicorn app:app --bind 0.0.0.0:$PORT");
  t.is(r.server, "gunicorn");
});

test("provider start hint beats framework detection", (t) => {
  const dir = project({ "main.py": "app = FastAPI()\n" });
  const r = resolve_start(dir, "fastapi", NO_CONFIG, "python main.py");
  t.is(r.start_command, "python main.py");
  t.is(r.server, null);
});

test("Django: manage.py + wsgi package → gunicorn <pkg>.wsgi", (t) => {
  const dir = project({
    "manage.py": "",
    "mysite/wsgi.py": "application = get_wsgi_application()",
  });
  const r = resolve_start(dir, "django", NO_CONFIG);
  t.is(r.start_command, "gunicorn mysite.wsgi:application --bind 0.0.0.0:$PORT");
  t.is(r.server, "gunicorn");
});

test("FastAPI: deps token + app = FastAPI( in main.py → uvicorn main:app", (t) => {
  const dir = project({ "main.py": "app = FastAPI()\n" });
  const r = resolve_start(dir, "fastapi\nuvicorn", NO_CONFIG);
  t.is(r.start_command, "uvicorn main:app --host 0.0.0.0 --port $PORT");
  t.is(r.server, "uvicorn");
});

test("module preference: app/main.py with pattern beats bare main.py without", (t) => {
  const dir = project({
    "main.py": "print('not the app')\n",
    "app/main.py": "app = FastAPI()\n",
  });
  const r = resolve_start(dir, "fastapi", NO_CONFIG);
  t.is(r.start_command, "uvicorn app.main:app --host 0.0.0.0 --port $PORT");
});

// Regression: a UTF-16 requirements.txt (PowerShell `>` / Notepad on Windows)
// used to be read as UTF-8, so `\bfastapi\b` never matched and framework
// detection was skipped — the deploy died with "Could not detect how to start
// this Python app" despite a valid FastAPI app. read_dependencies_text now
// decodes the BOM, so detection works. Real case: Gokul2100/task-manager-api.
test("UTF-16 requirements.txt still detects FastAPI (BOM-aware read)", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "faable-py-"));
  mkdirSync(join(dir, "app"), { recursive: true });
  writeFileSync(
    join(dir, "requirements.txt"),
    Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from("fastapi==0.139.0\r\nuvicorn==0.51.0\r\n", "utf16le"),
    ])
  );
  writeFileSync(join(dir, "app", "main.py"), "app = FastAPI(\n    title='x'\n)\n");

  const deps = read_dependencies_text(dir);
  const r = resolve_start(dir, deps, NO_CONFIG);
  t.is(r.start_command, "uvicorn app.main:app --host 0.0.0.0 --port $PORT");
  t.is(r.server, "uvicorn");
});

test("Flask: deps token + app = Flask( → gunicorn module:app", (t) => {
  const dir = project({ "app.py": "app = Flask(__name__)\n" });
  const r = resolve_start(dir, "flask", NO_CONFIG);
  t.is(r.start_command, "gunicorn app:app --bind 0.0.0.0:$PORT");
  t.is(r.server, "gunicorn");
});

test("nothing detectable → actionable error", (t) => {
  const dir = project({ "util.py": "x = 1\n" });
  const err = t.throws(() => resolve_start(dir, "", NO_CONFIG));
  t.regex(err!.message, /startCommand/);
});

// --- with_server_injection ---

test("server injected only when missing from deps", (t) => {
  t.is(
    with_server_injection("pip install -r requirements.txt", "gunicorn", "flask"),
    "pip install -r requirements.txt && pip install --no-cache-dir gunicorn"
  );
  t.is(
    with_server_injection("pip install -r requirements.txt", "gunicorn", "flask\ngunicorn"),
    "pip install -r requirements.txt"
  );
  t.is(
    with_server_injection("pip install -r requirements.txt", "uvicorn", "fastapi"),
    "pip install -r requirements.txt && pip install --no-cache-dir uvicorn[standard]"
  );
});

test("injection without a base install stands alone", (t) => {
  t.is(
    with_server_injection(undefined, "uvicorn", "fastapi"),
    "pip install --no-cache-dir uvicorn[standard]"
  );
});

test("nothing to install → 'true'", (t) => {
  t.is(with_server_injection(undefined, null, ""), "true");
  t.is(with_server_injection(undefined, "uvicorn", "uvicorn"), "true");
});
