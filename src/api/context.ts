import { FaableApi } from "./FaableApi";
import { apikey } from "./strategies/apikey";
import { authenticateOAuthApp } from "./strategies/authenticateOAuthApp";

export const context = async () => {
  const { config } = await import("./userdir_config");
  return {
    api: FaableApi.create({ authStrategy: apikey, auth: config }),
  };
};
