import fs from "fs-extra";
import path from "path";
import os from "os";
const faable_home = path.join(os.homedir(), ".faable");

export const config: {
  clientId?: string;
  clientSecret?: string;
  apikey?: string;
} = {};

const credentials_path = path.join(faable_home, "credentials");
if (fs.existsSync(credentials_path)) {
  // console.log("Loaded stored config");
  const creds = fs.readJSONSync(credentials_path);
  // console.log(creds);
  config.clientId = creds.clientId;
  config.clientSecret = creds.clientSecret;
  config.apikey = creds.apikey;
}

config.clientId = process.env.FAABLE_CLIENT_ID || config.clientId;
config.clientSecret = process.env.FAABLE_CLIENT_SECRET || config.clientSecret;
config.apikey = process.env.FAABLE_APIKEY || config.apikey;
