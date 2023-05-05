import { ConfigStore } from "../lib/ConfigStore";
import { FaableApi } from "./FaableApi";
import { apikey_strategy } from "./strategies/apikey.strategy";
import { authenticateOAuthApp } from "./strategies/authenticateOAuthApp";

export const context = async () => {
  const store = new ConfigStore();
  const apikey =
    process.env.FAABLE_APIKEY || (await store.loadCredentials())?.apikey;

  return {
    api: FaableApi.create({ authStrategy: apikey_strategy, auth: { apikey } }),
  };
};
