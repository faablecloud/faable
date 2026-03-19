import { FaableApi } from "./FaableApi";
import { apikey_strategy } from "./strategies/apikey.strategy";
import { getIDToken } from "@actions/core";
import { oidc_strategy } from "./strategies/oidc.strategy";
import { bearer_strategy } from "./strategies/bearer.strategy";
import { CredentialsStore } from "../lib/CredentialsStore";

export const context = async () => {
  let api: FaableApi | undefined;

  if (process.env.FAABLE_APIKEY) {
    // Apikey in environment
    const apikey = process.env.FAABLE_APIKEY;
    api = FaableApi.create({ authStrategy: apikey_strategy, auth: { apikey } });
  } else if (process.env.FAABLE_TOKEN) {
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
    const config = await store.loadCredentials();
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
