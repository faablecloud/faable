import { execFile } from "child_process";
import { CLI_PACKAGE } from "./UpdateChecker";

// `faable upgrade` right after a release used to say "Upgraded to X" and leave
// the old version installed. The registry's CDN caches the packument for up to
// five minutes per edge, so the edge that told us "latest is X" and the one
// `npm install …@latest` asked a moment later can disagree: npm resolved
// `latest` to the version already installed, did nothing, and exited 0.
//
// So: install the EXACT version (a stale edge then fails with ETARGET instead
// of silently keeping the old one), retry while the CDN catches up, and only
// call it done when the installed version is the one we asked for.

export interface UpgradeDeps {
  install: (version: string) => Promise<{ ok: boolean; output: string }>;
  installed: () => Promise<string | undefined>;
  sleep: (ms: number) => Promise<void>;
}

// One flat shape: this repo is not `strict`, so a union on `ok` would not
// narrow at the call site.
export interface UpgradeResult {
  ok: boolean;
  attempts?: number;
  reason?: "not_propagated" | "install_failed";
  output?: string;
  installed?: string;
}

// npm's ways of saying "that version does not exist (here, yet)".
const NOT_FOUND = /ETARGET|notarget|No matching version|E404/i;

export const upgradeTo = async (
  target: string,
  deps: UpgradeDeps,
  { attempts = 5, wait_ms = 30_000, onRetry = (_n: number) => {} } = {}
): Promise<UpgradeResult> => {
  let output = "";
  for (let n = 1; n <= attempts; n++) {
    const res = await deps.install(target);
    output = res.output;
    if (res.ok) {
      const installed = await deps.installed();
      if (installed === target) return { ok: true, attempts: n };
      // npm said yes and changed nothing: the same lag, from another angle.
    } else if (!NOT_FOUND.test(res.output)) {
      return { ok: false, reason: "install_failed", output };
    }
    if (n < attempts) {
      onRetry(n);
      await deps.sleep(wait_ms);
    }
  }
  return {
    ok: false,
    reason: "not_propagated",
    output,
    installed: await deps.installed(),
  };
};

const run = (
  file: string,
  args: string[],
  timeout: number
): Promise<{ ok: boolean; output: string }> =>
  new Promise((resolve) => {
    execFile(file, args, { timeout, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) =>
      resolve({ ok: !err, output: `${stdout ?? ""}${stderr ?? ""}` })
    );
  });

const npm = process.platform === "win32" ? "npm.cmd" : "npm";

/** The real thing: global npm. */
export const npmDeps: UpgradeDeps = {
  install: (version) =>
    run(npm, ["install", "-g", "--prefer-online", `${CLI_PACKAGE}@${version}`], 180_000),
  installed: async () => {
    const res = await run(npm, ["ls", "-g", "--json", "--depth=0", CLI_PACKAGE], 30_000);
    try {
      return JSON.parse(res.output).dependencies?.[CLI_PACKAGE]?.version;
    } catch {
      return undefined;
    }
  },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};
