// import { CredentialsStore } from "../lib/CredentialsStore";
import { FaableApi } from "./FaableApi";
import { apikey_strategy } from "./strategies/apikey.strategy";
import {getIDToken} from "@actions/core";
import { oidc_strategy } from "./strategies/oidc.strategy";

export const context = async () => {

  let api:FaableApi;
  if(process.env.FAABLE_APIKEY){
    const apikey = process.env.FAABLE_APIKEY;
    api = FaableApi.create({ authStrategy: apikey_strategy, auth: { apikey } })
  }


  //const store = new CredentialsStore();
  //(await store.loadCredentials())?.apikey

  // Github actions environment
  if (process.env.GITHUB_ACTIONS === 'true') {
    try {
      const idToken = process.env.FAABLE_ID_TOKEN || await getIDToken("https://faable.com");
      api = FaableApi.create({ authStrategy: oidc_strategy, auth: { idToken } })
    } catch (_) {
      console.error("Error fetching token, configure 'permissions: id-token: write'");
    }
  }


  return {
    api,
  };
};
