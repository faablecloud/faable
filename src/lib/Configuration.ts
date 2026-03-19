import path from "path";
import fs from "fs-extra";
import { log } from "../log";
interface ProjectConfig {
  startCommand?: string;
  buildCommand?: string;
  app_slug?: string;
}

export class Configuration {
  private static _instance: Configuration;
  private config: ProjectConfig = {};
  private config_file: string = "faable.json";

  private constructor() {
    // Try to read default config file
    this.setConfigFile("faable.json", { ignoreWarnings: true });
  }

  setConfigFile(file: string, options: { ignoreWarnings: boolean }) {
    this.config_file = file;
    const config_path = path.join(process.cwd(), file);
    if (fs.existsSync(config_path)) {
      this.config = fs.readJSONSync(config_path);
      log.info(`Loaded configuration from: ${file}`);
    } else {
      if (!options.ignoreWarnings) {
        log.warn(`Cannot read Faable config file ${file}`);
      }
    }
  }

  saveConfig(updates: Partial<ProjectConfig>) {
    this.config = { ...this.config, ...updates };
    const config_path = path.join(process.cwd(), this.config_file);
    fs.writeJSONSync(config_path, this.config, { spaces: 2 });
    log.info(`Configuration saved to: ${this.config_file}`);
  }

  public static instance() {
    if (!Configuration._instance) {
      Configuration._instance = new Configuration();
    }
    return Configuration._instance;
  }

  get startCommand() {
    return this.config.startCommand || "npm run start";
  }

  get buildCommand() {
    return this.config.buildCommand;
  }

  get app_slug() {
    return this.config.app_slug;
  }
}
