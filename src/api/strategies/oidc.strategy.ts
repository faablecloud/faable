import { create_base_client } from "../base_client";
import { AuthStrategyBuilder } from "./types";


type TokenExchange = {token:string, app_id:string}

const exchangeGithubOidcToken = async(gh_token:string)=>{
  const client = create_base_client()
  const res = await client.post<TokenExchange>("/auth/github-oidc",{
    token:gh_token
  })
  const {token, app_id} = res.data
  return {token, app_id}
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
        Authorization: `Bearer ${token_ex.token}`,
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
