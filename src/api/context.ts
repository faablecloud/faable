import { FaableApi } from "./FaableApi";
import { apikey_strategy } from "./strategies/apikey.strategy";
import { getIDToken } from "@actions/core";
import { oidc_strategy } from "./strategies/oidc.strategy";
import { bearer_strategy } from "./strategies/bearer.strategy";
import { CredentialsStore } from "../lib/CredentialsStore";
import { loadLiveCredentials } from "./session";
import { log } from "../log";

export const context = async () => {
  let api: FaableApi | undefined;

  // Auth resolution: FAABLE_TOKEN → OIDC (CI) → local `faable login` credentials.
  if (process.env.FAABLE_TOKEN) {
    // Token in environment
    const token = process.env.FAABLE_TOKEN;
    api = FaableApi.create({ authStrategy: bearer_strategy, auth: { token } });
  } else if (process.env.GITHUB_ACTIONS === "true") {
    // Github actions environment
    try {
      const idToken =
        process.env.FAABLE_ID_TOKEN || (await getIDToken("https://faable.com"));
      api = FaableApi.create({ authStrategy: oidc_strategy, auth: { idToken } });
    } catch (_) {
      console.error(
        "Error fetching token, configure 'permissions: id-token: write'"
      );
    }
  } else {
    const store = new CredentialsStore();
    // Auto-refreshes an expired access token via the stored refresh_token.
    const config = await loadLiveCredentials(store);
    if (config) {
      if (config.token) {
        api = FaableApi.create({
          authStrategy: bearer_strategy,
          auth: { token: config.token },
        });
      } else if (config.apikey) {
        api = FaableApi.create({
          authStrategy: apikey_strategy,
          auth: { apikey: config.apikey },
        });
      }
    }
  }

  const appId = await api?.strategy?.app_id?.();

  return {
    api,
    appId,
  };
};

// Resolve the API client for a command that needs an authenticated session.
// Exits with a uniform message when there is no session at all. An expired
// session that could not be refreshed still surfaces here as a working `api`
// whose first call returns 401 — FaableApi maps that to the same re-login hint.
export const requireApi = async () => {
  const ctx = await context();
  if (!ctx.api) {
    log.error("❌ Not logged in. Run 'faable login' first.");
    process.exit(1);
  }
  return ctx as { api: FaableApi; appId?: string };
};
