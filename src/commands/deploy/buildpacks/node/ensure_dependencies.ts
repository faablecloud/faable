import { existsSync } from "fs";
import { dirname, join } from "path";
import { log } from "../../../../log";
import { cmd } from "../../../../lib/cmd";

// Installing can be slow on cold CI runners (no npm cache).
const INSTALL_TIMEOUT = 15 * 60 * 1000; // 15 minute timeout

interface EnsureDependenciesDeps {
  /** Runs a shell command in `cwd`. */
  run?: (command: string, cwd: string) => Promise<unknown>;
  /** Whether a binary is available on PATH. */
  hasTool?: (name: string) => Promise<boolean>;
  exists?: (path: string) => boolean;
}

const defaultRun = (command: string, cwd: string) =>
  cmd(command, { cwd, timeout: INSTALL_TIMEOUT, enableOutput: true });

const defaultHasTool = async (name: string) => {
  try {
    await cmd(`command -v ${name}`);
    return true;
  } catch {
    return false;
  }
};

/**
 * Dependencies may live in the workdir or be hoisted to a parent directory
 * (monorepos). Walk upwards checking each level, stopping at the repo root
 * (first directory containing `.git`) or the filesystem root.
 */
const has_node_modules = (
  workdir: string,
  exists: (path: string) => boolean
): boolean => {
  let dir = workdir;
  while (true) {
    if (exists(join(dir, "node_modules"))) return true;
    if (exists(join(dir, ".git"))) return false;
    const parent = dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
};

/**
 * Install dependencies when `node_modules` is missing, so `faable deploy`
 * works without a prior `npm ci` step — the generated GitHub Actions workflow
 * is language-agnostic and no longer installs anything itself. The build
 * (`npm run build`) and the image (`COPY . .` ships node_modules) both need
 * dependencies present on the host.
 *
 * The install command honors the project's lockfile; yarn/pnpm fall back to
 * `npm install` when the tool is missing, which may resolve slightly
 * different versions.
 */
export const ensure_dependencies = async (
  workdir: string,
  deps: EnsureDependenciesDeps = {}
): Promise<void> => {
  const { run = defaultRun, hasTool = defaultHasTool, exists = existsSync } =
    deps;

  if (has_node_modules(workdir, exists)) {
    log.info(
      `📦 Dependencies already installed — skipping install (fresh dependencies)`
    );
    return;
  }

  const has = (file: string) => exists(join(workdir, file));
  let install = "npm install --no-audit --no-fund";
  if (has("package-lock.json") || has("npm-shrinkwrap.json")) {
    install = "npm ci";
  } else if (has("yarn.lock")) {
    if (await hasTool("yarn")) {
      install = "yarn install --frozen-lockfile";
    } else {
      log.warn("yarn.lock found but yarn is not installed — using npm install");
    }
  } else if (has("pnpm-lock.yaml")) {
    if (await hasTool("pnpm")) {
      install = "pnpm install --frozen-lockfile";
    } else {
      log.warn("pnpm-lock.yaml found but pnpm is not installed — using npm install");
    }
  }

  log.info(`📦 node_modules missing — installing dependencies [${install}]`);
  await run(install, workdir);
};
