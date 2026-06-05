import axios from "axios";
import { create_base_client } from "../base_client";
import { AuthStrategyBuilder } from "./types";


type TokenExchange = {access_token:string, app_id:string}

const exchangeGithubOidcToken = async(gh_token:string)=>{
  const client = create_base_client()
  try {
    const res = await client.post<TokenExchange>("/auth/github-oidc",{
      token:gh_token
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

export const oidc_strategy: AuthStrategyBuilder<{idToken:string}> = (
  config
) => {
  const { idToken } = config;
  if (!idToken) {
    throw new Error("Missing idToken.");
  }

  let token_ex:TokenExchange;

  return {
    headers: async () => {
      if(!token_ex){
        const ex =  await exchangeGithubOidcToken(idToken)
        token_ex = ex
      }
      return {
        Authorization: `Bearer ${token_ex.access_token}`,
      };
    },
    app_id: async () => {
      if(!token_ex){
        const ex = await exchangeGithubOidcToken(idToken)
        token_ex = ex
      }
      return token_ex.app_id;
    }
  };
};
