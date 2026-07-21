import axios from "axios";
import { create_base_client } from "../base_client";
import { AuthStrategyBuilder } from "./types";


type TokenExchange = {access_token:string, app_id:string}

const exchangeGithubOidcToken = async(gh_token:string, target_app_id?:string)=>{
  const client = create_base_client()
  try {
    // Monorepo: several apps share one repo, so the exchange can't infer which
    // app the workflow targets — pass the explicit app_id (`faable deploy
    // <app_id>`). The api verifies it's linked to the OIDC token's repository.
    const res = await client.post<TokenExchange>("/auth/github-oidc",{
      token:gh_token,
      ...(target_app_id ? { app_id: target_app_id } : {})
    })
    const {access_token, app_id} = res.data
    return {access_token, app_id}
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const status = err.response?.status
      const serverMessage = (err.response?.data as { message?: string } | undefined)?.message
      // No app is linked to this repository — turn the cryptic 404 into an
      // actionable next step.
      if (status === 404) {
        throw new Error(
          'No app linked to this repository. Run "faable link" locally to link it, ' +
            "or link it from the dashboard (https://dashboard.faable.com)."
        )
      }
      // Monorepo: several apps are linked to the same repository.
      if (status === 400) {
        throw new Error(
          serverMessage ||
            "This repository has multiple linked apps. Specify which one with `faable deploy <app_id>`."
        )
      }
      throw new Error(
        `Faable OIDC token exchange failed (${status ?? "network error"})${
          serverMessage ? `: ${serverMessage}` : ""
        }`
      )
    }
    throw err
  }
}

export const oidc_strategy: AuthStrategyBuilder<{
  idToken: string;
  appId?: string;
}> = (config) => {
  const { idToken, appId } = config;
  if (!idToken) {
    throw new Error("Missing idToken.");
  }

  let token_ex:TokenExchange;
  const ensure = async () => {
    if (!token_ex) token_ex = await exchangeGithubOidcToken(idToken, appId);
    return token_ex;
  };

  return {
    headers: async () => {
      const ex = await ensure();
      return {
        Authorization: `Bearer ${ex.access_token}`,
      };
    },
    app_id: async () => (await ensure()).app_id,
  };
};
