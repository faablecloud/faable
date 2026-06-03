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
