import { CredentialsStore, FaableConfig } from "../lib/CredentialsStore";
import { refreshToken } from "./auth";
import { log } from "../log";

// True when a stored JWT access token is still valid (has a future `exp`).
// Anything we can't decode, or without `exp`, counts as NOT live — callers then
// refresh or ask the user to re-login instead of trusting a dead token.
export const isTokenLive = (token: string): boolean => {
  try {
    const [, payload] = token.split(".");
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (typeof claims.exp !== "number") return false;
    // 30s skew so a near-expired token is treated as dead and refreshed early.
    return claims.exp * 1000 > Date.now() + 30_000;
  } catch {
    return false;
  }
};

// Load local credentials, transparently refreshing an expired (or near-expired)
// access token using the stored refresh_token. The refreshed credentials are
// persisted so the next command reuses them. Returns the (possibly refreshed)
// config, or undefined when there are no local credentials.
//
// This is the single place the CLI resolves a local session, so every command
// that goes through it gets auto-refresh for free. If the refresh fails (e.g.
// the refresh token itself expired or was revoked) we return the stale config
// and let the downstream 401 surface the uniform "session expired" error.
export const loadLiveCredentials = async (
  store: CredentialsStore = new CredentialsStore()
): Promise<FaableConfig | undefined> => {
  const config = await store.loadCredentials();
  if (!config) return undefined;

  const needsRefresh = !!config.token && !isTokenLive(config.token);
  if (needsRefresh && config.refresh_token) {
    try {
      const refreshed = await refreshToken(config.refresh_token);
      const next: FaableConfig = {
        ...config,
        token: refreshed.access_token,
        refresh_token: refreshed.refresh_token ?? config.refresh_token,
      };
      await store.saveCredentials(next);
      log.debug?.("Refreshed access token");
      return next;
    } catch {
      // Refresh failed — keep the stale config; the API call's 401 (or
      // requireApi) will tell the user to run `faable login` again.
    }
  }

  return config;
};
