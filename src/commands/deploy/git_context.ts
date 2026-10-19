import { exec } from "child_process";

export interface GitContext {
  github_commit?: string;
  github_ref?: string;
  github_actor?: string;
  github_commit_message?: string;
}

type Runner = (command: string) => Promise<string | undefined>;

// Quiet git runner: returns trimmed stdout, or undefined on any failure (not a
// git repo, git missing, etc.). A deploy must never fail because we couldn't
// read git metadata, so errors are swallowed and the field is just omitted.
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

// Ref from GitLab CI / Bitbucket Pipelines env, as a full `refs/...` name.
// Tags first: on a tag pipeline GitLab's CI_COMMIT_REF_NAME is the tag name.
// CI_COMMIT_REF_NAME (not CI_COMMIT_BRANCH) so merge request pipelines still
// record their source branch.
const ci_ref = (env: Record<string, string | undefined>) => {
  const tag = env.CI_COMMIT_TAG || env.BITBUCKET_TAG;
  if (tag) return `refs/tags/${tag}`;
  const branch = env.CI_COMMIT_REF_NAME || env.BITBUCKET_BRANCH;
  if (branch) return `refs/heads/${branch}`;
  return undefined;
};

// Resolve the commit / ref / actor for the current deploy. In GitHub Actions
// these come from the standard env vars; locally we fall back to git so manual
// deploys still record a commit. `github_actor` is CI-only (a GitHub login),
// left undefined locally where no reliable login is available. The commit
// message has no standard CI env var, so it is always read from git (for the
// resolved commit, falling back to HEAD) — the dashboard shows its first line.
export const git_context = async (opts?: {
  workdir?: string;
  env?: Record<string, string | undefined>;
  run?: Runner;
}): Promise<GitContext> => {
  const env = opts?.env ?? process.env;
  const run = opts?.run ?? gitRunner(opts?.workdir);

  const github_commit =
    env.GITHUB_SHA ||
    env.CI_COMMIT_SHA ||
    env.BITBUCKET_COMMIT ||
    (await run("git rev-parse HEAD"));

  // GitLab CI and Bitbucket Pipelines check out a detached HEAD, so the branch
  // only survives in their env vars. Their actor vars are NOT mapped to
  // `github_actor`: the dashboard renders it as a GitHub login (avatar and
  // profile link), and a GitLab username would show whoever owns that name on
  // GitHub.
  let github_ref = env.GITHUB_REF || ci_ref(env);
  if (!github_ref) {
    const branch = await run("git rev-parse --abbrev-ref HEAD");
    if (branch && branch !== "HEAD") github_ref = `refs/heads/${branch}`;
  }

  const github_actor = env.GITHUB_ACTOR || undefined;

  // Full commit message (subject + body) for the resolved commit; the dashboard
  // renders only the subject line. Fall back to HEAD when the SHA isn't
  // resolvable in the local checkout (e.g. shallow clones).
  const github_commit_message =
    (github_commit &&
      (await run(`git show -s --format=%B ${github_commit}`))) ||
    (await run("git log -1 --pretty=%B"));

  const ctx: GitContext = {};
  if (github_commit) ctx.github_commit = github_commit;
  if (github_ref) ctx.github_ref = github_ref;
  if (github_actor) ctx.github_actor = github_actor;
  if (github_commit_message) ctx.github_commit_message = github_commit_message;
  return ctx;
};
