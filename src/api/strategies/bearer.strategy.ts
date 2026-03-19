import { AuthStrategyBuilder } from "./types";

export const bearer_strategy: AuthStrategyBuilder<{ token: string }> = (
  config
) => {
  const { token } = config;
  if (!token) {
    throw new Error("Missing token.");
  }
  return {
    headers: async () => {
      return {
        Authorization: `Bearer ${token}`,
      };
    },
  };
};
