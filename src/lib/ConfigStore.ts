import path from "path";
import os from "os";
import fs from "fs-extra";
import { log as baselog } from "../log";
import { Logger } from "pino";

export interface FaableConfig {
  apikey: string;
}

export class ConfigStore {
  faable_home: string;
  constructor(private log: Logger = baselog) {
    this.faable_home = path.join(os.homedir(), ".faable");
  }

  async deleteCredentials() {
    await fs.remove(this.faable_home);
    this.log.info(`Deleted credentials`);
  }

  get credentials_path() {
    return path.join(this.faable_home, "credentials");
  }

  async saveApiKey(config: FaableConfig) {
    await fs.ensureDir(this.faable_home);
    await fs.writeJSON(this.credentials_path, config);
    this.log.info(`Stored apikey`);
  }

  async loadCredentials(): Promise<FaableConfig | undefined> {
    if (!fs.existsSync(this.credentials_path)) {
      // No credentials found
      return;
    }

    // Return credentials
    const config = await fs.readJSON(this.credentials_path);
    return config;
  }
}
