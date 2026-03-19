import path from "path";
import os from "os";
import fs from "fs-extra";
import { log as baselog } from "../log";
import { Logger } from "pino";

export interface FaableConfig {
  apikey?: string;
  token?: string;
  email?: string;
}

export class CredentialsStore {
  faable_home: string;
  constructor(private log: Logger = baselog) {
    this.faable_home = path.join(os.homedir(), ".faable");
  }

  async deleteCredentials() {
    if (fs.existsSync(this.credentials_path)) {
        await fs.remove(this.credentials_path);
    }
    this.log.info(`Deleted credentials`);
  }

  get credentials_path() {
    return path.join(this.faable_home, "auth.json");
  }

  async saveCredentials(config: FaableConfig) {
    await fs.ensureDir(this.faable_home);
    await fs.writeJSON(this.credentials_path, config, { spaces: 2 });
    await fs.chmod(this.credentials_path, 0o600);
    this.log.info(`Stored credentials`);
  }

  /**
   * @deprecated use saveCredentials
   */
  async saveApiKey(config: { apikey: string }) {
    return this.saveCredentials(config);
  }

  async loadCredentials(): Promise<FaableConfig | undefined> {
    const old_path = path.join(this.faable_home, "credentials");
    
    // Migration from old path if it exists
    if (fs.existsSync(old_path) && !fs.existsSync(this.credentials_path)) {
      const config = await fs.readJSON(old_path);
      await this.saveCredentials(config);
      await fs.remove(old_path);
      return config;
    }

    if (!fs.existsSync(this.credentials_path)) {
      // No credentials found
      return;
    }

    // Return credentials
    const config = await fs.readJSON(this.credentials_path);
    return config || {};
  }
}
