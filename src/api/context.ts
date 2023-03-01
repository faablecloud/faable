import { FaableApi } from "./FaableApi";
import { authenticateOAuthApp } from "./authenticateOAuthApp";
export const context = async () => {
  const authStrategy = authenticateOAuthApp;
  const { config } = await import("./userdir_config");
  return {
    api: FaableApi.create({ authStrategy, auth: config }),
  };
};
