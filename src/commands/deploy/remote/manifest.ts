import { execFile } from "child_process";
import { createHash } from "crypto";
import { lstatSync, mkdtempSync, readFileSync, rmSync } from "fs";
import * as os from "os";
import * as path from "path";
import { cmd } from "../../../lib/cmd";
import { log } from "../../../log";

export interface ManifestFile {
  path: string;
  sha: string;
  size: number;
  mode?: number;
}

// Server-side admission caps (mirror DeploymentSource on the API); checking
// here fails fast with a clearer message than a 400.
const MAX_FILES = 20_000;
const MAX_FILE_BYTES = 100 * 1024 * 1024;

/**
 * Collect the source tree for a remote build: exactly what git tracks (plus
 * untracked-but-not-ignored files), hashed for the CAS. Using git as the
 * collector means the upload is "the source" — build artifacts, node_modules
 * and local junk stay out via .gitignore, and the remote build re-derives
 * them like a fresh clone would.
 *
 * Symlinks are rejected (no representation in the manifest by design — see
 * deploy-v2-remote-build.md).
 *
 * A folder that is not a repository (`faable deploy` on a plain directory, the
 * MCP's deploy_directory) is collected by git too, through a throwaway index:
 * see list_without_repo.
 */
export const collect_manifest = async (
  workdir: string
): Promise<ManifestFile[]> => {
  const in_repo = await is_git_work_tree(workdir);

  // -c/-o: tracked + untracked; --exclude-standard: .gitignore/.git/info.
  // -z: NUL-separated (paths with spaces/UTF-8 survive).
  const rel_paths = in_repo
    ? split_z(
        (await cmd(`git ls-files -co --exclude-standard -z`, { cwd: workdir }))
          .stdout
      )
    : await list_without_repo(workdir);

  if (in_repo) {
    const warning = committed_venv_warning(rel_paths);
    if (warning) log.warn(warning);
  }

  if (rel_paths.length === 0) {
    throw new Error(
      in_repo
        ? "No files to upload (empty git tree?)"
        : `No files to upload in ${workdir}.`
    );
  }
  if (rel_paths.length > MAX_FILES) {
    throw new Error(
      `Too many files for a remote build (${rel_paths.length} > ${MAX_FILES}).`
    );
  }

  const manifest: ManifestFile[] = [];
  for (const rel of rel_paths) {
    const abs = path.join(workdir, rel);
    // lstat: a symlink must be detected as such, not followed.
    const stat = (() => {
      try {
        return lstatSync(abs, { throwIfNoEntry: false });
      } catch {
        return undefined;
      }
    })();
    // Listed but unreadable/deleted (e.g. staged deletion) → skip.
    if (!stat) continue;
    if (stat.isDirectory()) continue;
    if (stat.isSymbolicLink()) {
      throw new Error(
        `Symlinks are not supported: ${rel}. Replace the symlink with the real file.`
      );
    }
    if (stat.size > MAX_FILE_BYTES) {
      throw new Error(
        `${rel} is too large for a remote build (${stat.size} bytes > ${MAX_FILE_BYTES}).`
      );
    }
    const body = readFileSync(abs);
    manifest.push({
      // Manifest paths are forward-slash relative (API admission contract).
      path: rel.split(path.sep).join("/"),
      sha: createHash("sha256").update(body).digest("hex"),
      size: stat.size,
      mode: stat.mode & 0o777,
    });
  }
  return manifest;
};

// Outside a repository git exits 128 with `fatal: not a git repository`:
// that is the answer here, not an error to show — so not through cmd(), which
// logs a failing command's stderr and exit code.
const is_git_work_tree = (workdir: string): Promise<boolean> =>
  new Promise((resolve) => {
    execFile(
      "git",
      ["rev-parse", "--is-inside-work-tree"],
      { cwd: workdir },
      (err, stdout) => resolve(!err && String(stdout).trim() === "true")
    );
  });

const split_z = (out: unknown) =>
  String(out)
    .split("\0")
    .filter((p) => p.length > 0);

const shell_quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

// Out of an upload even when no .gitignore says so — a plain folder has none,
// and these are the files a repository would have ignored anyway. Python
// virtualenvs and bytecode: the buildpack recreates the venv (`uv venv`) and
// compiles its own bytecode, so uploading them only bloats the artifact
// (arch/abuse/keepalive-interno-free-24h.md). Not excluded on purpose: hidden
// paths in general (`.well-known/`, `.npmrc`, `.python-version` are content or
// build input) and `dist/`, `build/`, `out/` (a plain folder is often an
// already-built site uploaded as is).
export const NO_REPO_EXCLUDES = [
  "node_modules/",
  ".env",
  ".env.*",
  ".DS_Store",
  ".venv/",
  "venv/",
  "__pycache__/",
  "*.pyc",
  ".git/",
];

const PYVENV_CFG = "pyvenv.cfg";

// A virtualenv under any other name (`env/`, `.python/`…) is still a
// virtualenv: it is the folder that holds a pyvenv.cfg. Matched on the listing
// instead of with a git pattern so that an `env/` of config files stays in.
const without_virtualenvs = (paths: string[]): string[] => {
  const venv_dirs = paths
    .filter((p) => p.endsWith(`/${PYVENV_CFG}`))
    .map((p) => p.slice(0, -PYVENV_CFG.length));
  if (venv_dirs.length === 0) return paths;
  return paths.filter((p) => !venv_dirs.some((d) => p.startsWith(d)));
};

// More files than this under site-packages/ is an installed environment, not a
// vendored module or two.
const SITE_PACKAGES_WARN_THRESHOLD = 200;

/**
 * In a repository git decides what is uploaded, a committed virtualenv
 * included — but the build recreates it, so say so (and keep going).
 */
export const committed_venv_warning = (paths: string[]): string | undefined => {
  const cfg = paths.find(
    (p) => p === PYVENV_CFG || p.endsWith(`/${PYVENV_CFG}`)
  );
  const site_packages = paths.filter((p) =>
    `/${p}`.includes("/site-packages/")
  ).length;
  if (!cfg && site_packages <= SITE_PACKAGES_WARN_THRESHOLD) return undefined;
  const dir = cfg?.slice(0, -PYVENV_CFG.length);
  const found = dir
    ? `${dir} is a Python virtualenv`
    : cfg
      ? "the repository root is a Python virtualenv"
      : `${site_packages} files under site-packages/ look like a Python virtualenv`;
  return `⚠️ ${found} committed to the repository. The build recreates it, so it only makes the upload bigger: add ${dir || "it"} to .gitignore.`;
};

/**
 * The files of a folder that is not a git repository. Git still lists them:
 * a temporary repository holds the index and the folder is its work tree, so
 * every .gitignore inside counts exactly as it would in a clone, and nothing
 * is written to the folder (arch/deploy/cli-mcp-fallos-2026-10-16-plan.md, F3).
 */
const list_without_repo = async (workdir: string): Promise<string[]> => {
  const git_dir = mkdtempSync(path.join(os.tmpdir(), "faable-manifest-"));
  try {
    await cmd(`git init -q ${shell_quote(git_dir)}`).catch(() => {
      throw new Error(
        "Deploys collect the source with git, and git is not available. Install git and try again."
      );
    });
    log.info(
      `📂 ${workdir} is not a git repository: uploading the folder (its .gitignore files apply; ${NO_REPO_EXCLUDES.join(", ")} and Python virtualenvs stay out)`
    );
    const excludes = NO_REPO_EXCLUDES.map((p) => `-x ${shell_quote(p)}`).join(" ");
    const out = await cmd(
      `git --git-dir=${shell_quote(path.join(git_dir, ".git"))} --work-tree=${shell_quote(workdir)} ls-files -o --exclude-standard ${excludes} -z`,
      { cwd: workdir }
    );
    return without_virtualenvs(split_z(out.stdout));
  } finally {
    rmSync(git_dir, { recursive: true, force: true });
  }
};
