import test from "ava";
import { git_context } from "./git_context";

test("prefers GitHub Actions env vars, but reads the commit message from git", async (t) => {
  const ctx = await git_context({
    env: {
      GITHUB_SHA: "abc123",
      GITHUB_REF: "refs/heads/main",
      GITHUB_ACTOR: "octocat",
    } as any,
    run: async (command) => {
      // commit/ref/actor come from env — git must not be consulted for them.
      if (command.includes("rev-parse") || command.includes("abbrev-ref")) {
        throw new Error("git should not be called when env is present");
      }
      // The commit message has no env var, so it is always read from git.
      if (command.includes("--format=%B")) return "feat: add thing\n\nbody";
      return undefined;
    },
  });
  t.deepEqual(ctx, {
    github_commit: "abc123",
    github_ref: "refs/heads/main",
    github_actor: "octocat",
    github_commit_message: "feat: add thing\n\nbody",
  });
});

test("reads commit and ref from GitLab CI env, never the actor", async (t) => {
  const run = async (command: string) => {
    if (command.includes("rev-parse")) {
      throw new Error("git should not be called when CI env is present");
    }
    if (command.includes("--format=%B")) return "fix: thing";
    return undefined;
  };
  const branch = await git_context({
    env: {
      CI_COMMIT_SHA: "c0ffee",
      CI_COMMIT_REF_NAME: "feature/x",
      GITLAB_USER_LOGIN: "someone",
    } as any,
    run,
  });
  t.deepEqual(branch, {
    github_commit: "c0ffee",
    github_ref: "refs/heads/feature/x",
    github_commit_message: "fix: thing",
  });

  const tag = await git_context({
    env: {
      CI_COMMIT_SHA: "c0ffee",
      CI_COMMIT_TAG: "v1.2.0",
      CI_COMMIT_REF_NAME: "v1.2.0",
    } as any,
    run,
  });
  t.is(tag.github_ref, "refs/tags/v1.2.0");
});

test("reads commit and ref from Bitbucket Pipelines env", async (t) => {
  const ctx = await git_context({
    env: { BITBUCKET_COMMIT: "beef", BITBUCKET_BRANCH: "main" } as any,
    run: async (command) => {
      if (command.includes("rev-parse")) {
        throw new Error("git should not be called when CI env is present");
      }
      return undefined;
    },
  });
  t.deepEqual(ctx, { github_commit: "beef", github_ref: "refs/heads/main" });

  const tag = await git_context({
    env: { BITBUCKET_COMMIT: "beef", BITBUCKET_TAG: "v2" } as any,
    run: async () => undefined,
  });
  t.is(tag.github_ref, "refs/tags/v2");
});

test("falls back to git locally and builds refs/heads from branch", async (t) => {
  const ctx = await git_context({
    env: {} as any,
    run: async (command) => {
      if (command.includes("rev-parse HEAD")) return "deadbeef";
      if (command.includes("abbrev-ref")) return "feature/x";
      return undefined;
    },
  });
  t.deepEqual(ctx, {
    github_commit: "deadbeef",
    github_ref: "refs/heads/feature/x",
  });
  t.is(ctx.github_actor, undefined);
});

test("omits ref when detached HEAD and omits everything outside a repo", async (t) => {
  const detached = await git_context({
    env: {} as any,
    run: async (command) =>
      command.includes("rev-parse HEAD") ? "sha" : "HEAD",
  });
  t.is(detached.github_ref, undefined);
  t.is(detached.github_commit, "sha");

  const noRepo = await git_context({
    env: {} as any,
    run: async () => undefined,
  });
  t.deepEqual(noRepo, {});
});
