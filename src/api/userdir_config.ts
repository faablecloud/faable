import fs from "fs-extra";
import path from "path";
import os from "os";
const faable_home = path.join(os.homedir(), ".faable");

export const config: {
  clientId?: string;
  clientSecret?: string;
} = {};

const credentials_path = path.join(faable_home, "credentials");
if (fs.existsSync(credentials_path)) {
  // console.log("Loaded stored config");
  const creds = fs.readJSONSync(credentials_path);
  // console.log(creds);
  config.clientId = creds.clientId;
  config.clientSecret = creds.clientSecret;
}

if (process.env.FAABLE_CLIENT_ID && process.env.FAABLE_CLIENT_SECRET) {
  config.clientId = process.env.FAABLE_CLIENT_ID;
  config.clientSecret = process.env.FAABLE_CLIENT_SECRET;
}
