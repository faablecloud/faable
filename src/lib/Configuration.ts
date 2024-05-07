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

  private constructor(public workdir: string) {
    // Try to read default config file
    this.setConfigFile("faable.json", { ignoreWarnings: true });
  }

  setConfigFile(file: string, options: { ignoreWarnings: boolean }) {
    const config_file = path.join(this.workdir, file);
    if (fs.existsSync(config_file)) {
      this.config = fs.readJSONSync(config_file);
      log.info(`Loaded configuration from: ${file}`);
    } else {
      if (!options.ignoreWarnings) {
        log.warn(`Cannot read Faable config file ${file}`);
      }
    }
  }

  public static instance(workdir: string) {
    if (!Configuration._instance) {
      Configuration._instance = new Configuration(workdir);
    }
    return Configuration._instance;
  }

  getConfigProperty<T>(name: string, defaultValue?: T) {
    return this.config[name] || defaultValue;
  }
}
