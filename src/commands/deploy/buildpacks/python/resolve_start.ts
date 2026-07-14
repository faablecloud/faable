import fs from "fs-extra";
import path from "path";
import { log } from "../../../../log";
import { DeployConfig } from "../Buildpack";
import { read_text_file } from "../shared/read_text_file";
import { parse_procfile } from "./parse_procfile";

export type Server = "gunicorn" | "uvicorn" | null;

/** Combine all classic dependency manifests into one lowercased blob. */
export const read_dependencies_text = (workdir: string): string => {
  const files = ["requirements.txt", "pyproject.toml", "Pipfile"];
  return files
    .map((f) => path.join(workdir, f))
    .filter((p) => fs.existsSync(p))
    .map((p) => read_text_file(p))
    .join("\n")
    .toLowerCase();
};

export const has_token = (deps: string, token: string) =>
  new RegExp(`\\b${token}\\b`).test(deps);

/** Identify which server binary a start command relies on, to ensure it's installed. */
const server_from_command = (command: string): Server => {
  const bin = command.trim().split(/\s+/)[0];
  if (bin === "gunicorn") return "gunicorn";
  if (bin === "uvicorn") return "uvicorn";
  return null;
};

/** Django project package = the directory that contains wsgi.py. */
const find_django_package = (workdir: string): string | null => {
  const entries = fs.readdirSync(workdir, { withFileTypes: true });
  for (const entry of entries) {
    if (
      entry.isDirectory() &&
      fs.existsSync(path.join(workdir, entry.name, "wsgi.py"))
    ) {
      return entry.name;
    }
  }
  return null;
};

/**
 * Find the module that defines the app object, returning its dotted module path
 * (e.g. `main`, `app.main`). Prefers a file matching `pattern`, else the first
 * existing candidate.
 */
export const find_app_module = (
  workdir: string,
  pattern: RegExp
): string | null => {
  const candidates = [
    "main.py",
    "app.py",
    "asgi.py",
    "wsgi.py",
    "application.py",
    "server.py",
    path.join("app", "main.py"),
    path.join("app", "app.py"),
    path.join("src", "main.py"),
  ];

  let first_existing: string | null = null;
  for (const rel of candidates) {
    const abs = path.join(workdir, rel);
    if (!fs.existsSync(abs)) continue;
    const module = rel.replace(/\.py$/, "").split(path.sep).join(".");
    if (!first_existing) first_existing = module;
    if (pattern.test(read_text_file(abs))) return module;
  }
  return first_existing;
};

/**
 * Resolve the container start command and which server it needs installed.
 * Precedence: faable.json startCommand → Procfile `web:` → provider start
 * hint (e.g. cerebrium entrypoint) → framework detection (Django → FastAPI/
 * ASGI → Flask).
 */
export const resolve_start = (
  workdir: string,
  deps: string,
  config: DeployConfig,
  start_hint?: string
): { start_command: string; server: Server } => {
  // 1. Explicit override in faable.json
  if (config.startCommand) {
    log.info(`Using start command from faable.json`);
    return {
      start_command: config.startCommand,
      server: server_from_command(config.startCommand),
    };
  }

  // 2. Procfile `web:` line
  const procfile = parse_procfile(workdir);
  if (procfile) {
    log.info(`Using start command from Procfile`);
    return { start_command: procfile, server: server_from_command(procfile) };
  }

  // 3. Provider hint (e.g. cerebrium.toml runtime entrypoint)
  if (start_hint) {
    log.info(`Using start command from the project manifest`);
    return { start_command: start_hint, server: server_from_command(start_hint) };
  }

  // 4. Framework detection
  // Django: manage.py + the package holding wsgi.py
  if (fs.existsSync(path.join(workdir, "manage.py"))) {
    const pkg = find_django_package(workdir);
    if (!pkg) {
      throw new Error(
        "Detected Django (manage.py) but couldn't find the wsgi.py package. Set `startCommand` in faable.json or add a Procfile."
      );
    }
    return {
      start_command: `gunicorn ${pkg}.wsgi:application --bind 0.0.0.0:$PORT`,
      server: "gunicorn",
    };
  }

  // FastAPI / ASGI
  if (
    has_token(deps, "fastapi") ||
    has_token(deps, "starlette") ||
    has_token(deps, "uvicorn")
  ) {
    const module = find_app_module(workdir, /app\s*=\s*(FastAPI|Starlette)\(/i);
    if (module) {
      return {
        start_command: `uvicorn ${module}:app --host 0.0.0.0 --port $PORT`,
        server: "uvicorn",
      };
    }
  }

  // Flask
  if (has_token(deps, "flask")) {
    const module = find_app_module(workdir, /app\s*=\s*Flask\(/i);
    if (module) {
      return {
        start_command: `gunicorn ${module}:app --bind 0.0.0.0:$PORT`,
        server: "gunicorn",
      };
    }
  }

  throw new Error(
    "Could not detect how to start this Python app. Set `startCommand` in faable.json or add a Procfile with a `web:` line."
  );
};

/**
 * Append the WSGI/ASGI server install when the start command needs one that
 * isn't already declared in the dependencies. Returns "true" (no-op) when
 * there is nothing to install at all.
 */
export const with_server_injection = (
  base: string | undefined,
  server: Server,
  deps: string
): string => {
  const steps: string[] = base ? [base] : [];
  if (server === "gunicorn" && !has_token(deps, "gunicorn")) {
    steps.push("pip install --no-cache-dir gunicorn");
  }
  if (server === "uvicorn" && !has_token(deps, "uvicorn")) {
    steps.push("pip install --no-cache-dir uvicorn[standard]");
  }
  if (steps.length === 0) {
    return "true";
  }
  return steps.join(" && ");
};
