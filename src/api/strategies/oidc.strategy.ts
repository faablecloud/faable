import { AuthStrategyBuilder } from "./types";

export const oidc_strategy: AuthStrategyBuilder<{idToken:string}> = (
  config
) => {
  const { idToken } = config;
  if (!idToken) {
    throw new Error("Missing idToken.");
  }
  return {
    headers: async () => {
      return {
        Authorization: `Bearer ${idToken}`,
      };
    },
  };
};
