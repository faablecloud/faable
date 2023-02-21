import { FaableAppsApi } from "./faable_api";

export const context = async () => {
  const strategy = (await import("./authenticateOAuthApp"))
    .authenticateOAuthApp;
  return {
    api: FaableAppsApi.create({ authStrategy: strategy }),
  };
};
