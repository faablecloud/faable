import { createHash } from "crypto";
import { lstatSync, readFileSync } from "fs";
import * as path from "path";
import { cmd } from "../../../lib/cmd";

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
 * deploy-v2-remote-build.md) and a non-git directory is unsupported (the source
 * tree is collected via git).
 */
export const collect_manifest = async (
  workdir: string
): Promise<ManifestFile[]> => {
  const inside = await cmd(`git rev-parse --is-inside-work-tree`, {
    cwd: workdir,
  }).catch(() => null);
  if (!inside || String(inside.stdout).trim() !== "true") {
    throw new Error(
      "Deploys need a git repository (the source tree is collected via git). Initialize one with `git init` and commit your files."
    );
  }

  // -c/-o: tracked + untracked; --exclude-standard: .gitignore/.git/info.
  // -z: NUL-separated (paths with spaces/UTF-8 survive).
  const out = await cmd(`git ls-files -co --exclude-standard -z`, {
    cwd: workdir,
  });
  const rel_paths = String(out.stdout)
    .split("\0")
    .filter((p) => p.length > 0);

  if (rel_paths.length === 0) {
    throw new Error("No files to upload (empty git tree?)");
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
