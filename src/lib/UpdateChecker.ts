import { spawn } from "child_process";
import fs from "fs-extra";
import os from "os";
import path from "path";
import { log } from "../log";

export const CLI_PACKAGE = "@faable/faable";

const REGISTRY_URL = `https://registry.npmjs.org/${CLI_PACKAGE}/latest`;
// Hitting the registry at most once a day keeps the background refresh rare.
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const UPGRADE_FETCH_TIMEOUT_MS = 10_000;

export interface UpdateCache {
  last_check?: string;
  latest?: string;
}

const cache_path = () => path.join(os.homedir(), ".faable", "update-check.json");

// Local dev runs with the semantic-release placeholder version.
export const isDevBuild = (version: string) => version.startsWith("0.0.0");

export const isCacheStale = (cache: UpdateCache, now: number): boolean => {
  if (!cache.last_check) return true;
  const last = new Date(cache.last_check).getTime();
  return Number.isNaN(last) || now - last > CHECK_INTERVAL_MS;
};

export const isNewerVersion = (latest: string, current: string): boolean => {
  const parse = (v: string) => {
    const [core, prerelease] = v.replace(/^v/, "").split("-");
    const [major = 0, minor = 0, patch = 0] = core.split(".").map(Number);
    return { major, minor, patch, prerelease };
  };
  const a = parse(latest);
  const b = parse(current);
  if (a.major !== b.major) return a.major > b.major;
  if (a.minor !== b.minor) return a.minor > b.minor;
  if (a.patch !== b.patch) return a.patch > b.patch;
  // Same core version: the release wins over its own prereleases.
  return !a.prerelease && !!b.prerelease;
};

const readCache = async (): Promise<UpdateCache> => {
  try {
    return await fs.readJSON(cache_path());
  } catch {
    return {};
  }
};

const writeCache = async (cache: UpdateCache) => {
  try {
    await fs.ensureDir(path.dirname(cache_path()));
    await fs.writeJSON(cache_path(), cache, { spaces: 2 });
  } catch {
    // A read-only home dir shouldn't break the CLI.
  }
};

// Refresh the cache from a detached child so the current run never waits on
// the network (update-notifier pattern): the notice shows on the next run.
const spawnBackgroundRefresh = () => {
  const script = `fetch(${JSON.stringify(REGISTRY_URL)})
    .then((r) => r.json())
    .then((d) => require("fs").writeFileSync(${JSON.stringify(cache_path())},
      JSON.stringify({ last_check: new Date().toISOString(), latest: d.version }, null, 2)))
    .catch(() => {})`;
  try {
    spawn(process.execPath, ["-e", script], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    }).unref();
  } catch {
    // No update check is worth failing a command over.
  }
};

/**
 * Fetch the latest published version, updating the cache. Only used by
 * `faable upgrade`, where the user explicitly asked and waiting is expected.
 */
export const getLatestVersion = async (): Promise<string | undefined> => {
  try {
    const res = await fetch(REGISTRY_URL, {
      signal: AbortSignal.timeout(UPGRADE_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return;
    const data = (await res.json()) as { version?: string };
    if (data.version) {
      await writeCache({ last_check: new Date().toISOString(), latest: data.version });
    }
    return data.version;
  } catch {
    return;
  }
};

export const notifyIfUpdateAvailable = async (current: string) => {
  if (isDevBuild(current) || process.env.CI || process.env.GITHUB_ACTIONS) {
    return;
  }
  const cache = await readCache();
  if (cache.latest && isNewerVersion(cache.latest, current)) {
    log.warn(
      `⬆️ Update available: ${current} → ${cache.latest}. Run \`faable upgrade\` to get the latest version.`
    );
  }
  if (isCacheStale(cache, Date.now())) {
    // Stamp the attempt first so a failing child can't cause a spawn storm:
    // whatever happens, the next refresh is a day away.
    await writeCache({ ...cache, last_check: new Date().toISOString() });
    spawnBackgroundRefresh();
  }
};
