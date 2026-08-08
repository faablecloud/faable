import { exec } from "child_process";

type Runner = (command: string) => Promise<string | undefined>;

// Quiet git runner, same contract as git_context's: trimmed stdout or
// undefined on any failure. A deploy must never fail because a release
// version couldn't be proposed.
const gitRunner =
  (workdir?: string): Runner =>
  command =>
    new Promise(resolve => {
      exec(command, { cwd: workdir }, (err, stdout) => {
        if (err) return resolve(undefined);
        const out = stdout?.toString().trim();
        resolve(out || undefined);
      });
    });

/**
 * Propose the release version for a deploy (Sentry propose-version pattern):
 * explicit `--release` > `FAABLE_RELEASE` env > latest reachable git tag
 * (e.g. the tag semantic-release created) > undefined. The release is FREE
 * TEXT and travels VERBATIM — no `v` stripping, no shape validation; only
 * the dashboard footer prepends a display `v`. When undefined the field is
 * omitted from the deployment and the platform injects no FAABLE_RELEASE —
 * the app falls back to its own version source. No SHA fallback: the commit
 * already travels as `github_commit`.
 */
export const propose_release = async (opts?: {
  workdir?: string;
  explicit?: string;
  env?: Record<string, string | undefined>;
  run?: Runner;
}): Promise<{ release: string; source: string } | undefined> => {
  const env = opts?.env ?? process.env;
  const run = opts?.run ?? gitRunner(opts?.workdir);

  if (opts?.explicit) return { release: opts.explicit, source: "--release" };
  if (env.FAABLE_RELEASE)
    return { release: env.FAABLE_RELEASE, source: "FAABLE_RELEASE env" };

  // Latest tag reachable from HEAD, verbatim. Version-shaped tags are tried
  // first so a repo that also tags non-releases still prefers its releases.
  for (const cmd of [
    `git describe --tags --abbrev=0 --match "v[0-9]*"`,
    `git describe --tags --abbrev=0`,
  ]) {
    const tag = await run(cmd);
    if (tag) return { release: tag, source: `git tag ${tag}` };
  }
  return undefined;
};
