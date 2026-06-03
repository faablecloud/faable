import fs from "fs-extra";
import path from "path";
import { log } from "../../../log";
import { Configuration } from "../../../lib/Configuration";
import { parse_procfile } from "./parse_procfile";

interface AnalyzePython {
  workdir: string;
}

export interface PythonAnalysis {
  /** Command run inside the Docker build to install dependencies. */
  install_command: string;
  /** Container start command (binds 0.0.0.0:$PORT). */
  start_command: string;
}

type Server = "gunicorn" | "uvicorn" | null;

/** Combine all dependency manifests into one lowercased blob for cheap lookups. */
const read_dependencies_text = (workdir: string): string => {
  const files = ["requirements.txt", "pyproject.toml", "Pipfile"];
  return files
    .map((f) => path.join(workdir, f))
    .filter((p) => fs.existsSync(p))
    .map((p) => fs.readFileSync(p).toString())
    .join("\n")
    .toLowerCase();
};

const has_token = (deps: string, token: string) =>
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
const find_app_module = (
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
    if (pattern.test(fs.readFileSync(abs).toString())) return module;
  }
  return first_existing;
};

/** Resolve the container start command and which server it needs installed. */
const resolve_start = (
  workdir: string,
  deps: string
): { start_command: string; server: Server } => {
  // 1. Explicit override in faable.json
  const configured = Configuration.instance().configuredStartCommand;
  if (configured) {
    log.info(`Using start command from faable.json`);
    return { start_command: configured, server: server_from_command(configured) };
  }

  // 2. Procfile `web:` line
  const procfile = parse_procfile(workdir);
  if (procfile) {
    log.info(`Using start command from Procfile`);
    return { start_command: procfile, server: server_from_command(procfile) };
  }

  // 3. Framework detection
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

/** Build the dependency-install command run during the Docker build. */
const build_install_command = (
  workdir: string,
  server: Server,
  deps: string
): string => {
  const steps: string[] = [];

  const configured_build = Configuration.instance().buildCommand;
  if (configured_build) {
    steps.push(configured_build);
  } else if (fs.existsSync(path.join(workdir, "requirements.txt"))) {
    steps.push("pip install --no-cache-dir -r requirements.txt");
  } else if (fs.existsSync(path.join(workdir, "pyproject.toml"))) {
    steps.push("pip install --no-cache-dir .");
  } else if (fs.existsSync(path.join(workdir, "Pipfile"))) {
    steps.push("pip install --no-cache-dir pipenv && pipenv install --system --deploy");
  }

  // Ensure the WSGI/ASGI server is available when not already declared.
  if (server === "gunicorn" && !has_token(deps, "gunicorn")) {
    steps.push("pip install --no-cache-dir gunicorn");
  }
  if (server === "uvicorn" && !has_token(deps, "uvicorn")) {
    steps.push("pip install --no-cache-dir uvicorn[standard]");
  }

  if (steps.length === 0) {
    // No manifest found — nothing to install, but warn the user.
    log.warn("No requirements.txt/pyproject.toml/Pipfile found");
    return "true";
  }

  return steps.join(" && ");
};

export const analyze_python = async (
  params: AnalyzePython
): Promise<PythonAnalysis> => {
  const { workdir } = params;
  const deps = read_dependencies_text(workdir);

  const { start_command, server } = resolve_start(workdir, deps);
  const install_command = build_install_command(workdir, server, deps);

  log.info(`📦 Install command: ${install_command}`);
  log.info(`⚙️ Start command: ${start_command}`);

  return { install_command, start_command };
};
