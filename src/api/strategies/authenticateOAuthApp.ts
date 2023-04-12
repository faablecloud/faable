import axios from "axios";
import { AuthStrategyBuilder } from "../types";

interface ClientCredentials {
  clientId: string;
  clientSecret: string;
}

type TokenResponse = {
  access_token: string;
  expires_in: number;
  token_type: string;
};

export const authenticateOAuthApp: AuthStrategyBuilder<
  Partial<ClientCredentials>
> = (creds) => {
  const { clientId, clientSecret } = creds;
  if (!clientId || !clientSecret) {
    throw new Error("Missing credentials. Run faable configure first.");
  }

  const client = axios.create({ baseURL: "https://api-auth.app.faable.com" });
  let cache_token: TokenResponse;
  const fetch_token = async () => {
    // Send client credentials in POST body. Can also be sent as basic auth header.
    const res = await client.post<TokenResponse>("/oauth/token", {
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
    });
    //console.log(`Fetched Token!`);
    // Cache the token
    cache_token = res.data;
    return cache_token;
  };

  return {
    headers: async () => {
      // TODO: Check token is not expired
      const { token_type, access_token } = cache_token
        ? cache_token
        : await fetch_token();
      return {
        Authorization: `${token_type} ${access_token}`,
      };
    },
  };
};
