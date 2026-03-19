import { base_client } from "../base_client";
import { AuthStrategyBuilder } from "./types";


const exchangeGithubOidcToken = async(gh_token:string)=>{

  const res = await base_client.post("/auth/github-oidc",{
    token:gh_token
  })
  const {token} =res.data
  console.log("Obtained github token exchange")
  console.log(token)
  return token
}

export const oidc_strategy: AuthStrategyBuilder<{idToken:string}> = (
  config
) => {
  const { idToken } = config;
  if (!idToken) {
    throw new Error("Missing idToken.");
  }

  let token:string="";

  return {
    headers: async () => {
      if(!token){
        token =  await exchangeGithubOidcToken(idToken)
      }
      return {
        Authorization: `Bearer ${token}`,
      };
    },
  };
};
