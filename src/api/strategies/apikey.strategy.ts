import axios from "axios";
import { AuthStrategyBuilder } from "./types";

interface ApikeyConfig {
  apikey: string;
}

export const apikey_strategy: AuthStrategyBuilder<Partial<ApikeyConfig>> = (
  config
) => {
  const { apikey } = config;
  if (!apikey) {
    throw new Error("Missing apikey.");
  }
  return {
    headers: async () => {
      return {
        Authorization: `Basic ${Buffer.from(`${apikey}:`).toString("base64")}`,
      };
    },
  };
};
