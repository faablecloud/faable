import { AuthStrategyBuilder } from "./types";
import axios from 'axios'

type TokenExchange = {access_token:string, token_type:string, expires_in:number}


const auth = axios.create({
  baseURL:"https://faable.auth.staging.faable.link",
  
})
const exchangeGithubOidcToken = async(gh_token:string)=>{

  const res = await auth.post<TokenExchange>("/oauth/token",{
    grant_type:"urn:ietf:params:oauth:grant-type:token-exchange",
    subject_token_type:"urn:ietf:params:oauth:token-type:jwt",
    subject_token:gh_token,
    resource:"https://faable.com",
    audience:"https://faable.com",
    scope:"openid email profile",
  })
  return res.data
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
      return token_ex.access_token;
    }
  };
};
