import path from "path";
import fs from "fs-extra";
import { log } from "../log";
interface ProjectConfig {
  startCommand?: string;
  buildCommand?: string;
}

export class Configuration {
  private static _instance: Configuration;
  private config: ProjectConfig = {};

  private constructor() {
    // Try to read default config file
    this.setConfigFile("faable.json", { ignoreWarnings: true });
  }

  setConfigFile(file: string, options: { ignoreWarnings: boolean }) {
    const config_file = path.join(process.cwd(), file);
    if (fs.existsSync(config_file)) {
      this.config = fs.readJSONSync(config_file);
      log.info(`Loaded configuration from: ${file}`);
    } else {
      if (!options.ignoreWarnings) {
        log.warn(`Cannot read Faable config file ${file}`);
      }
    }
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
}
