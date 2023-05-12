import path from "path";
import fs from "fs-extra";

interface ProjectConfig {
  startCommand?: string;
  buildCommand?: string;
}

export class Configuration {
  private static _instance: Configuration;
  private config?: ProjectConfig;

  private constructor() {
    const config_file = path.join(process.cwd(), "faable.json");
    if (fs.existsSync(config_file)) {
      this.config = fs.readJSONSync(config_file);
    }
  }

  static instance() {
    if (Configuration._instance) {
      return Configuration._instance;
    }
    return new Configuration();
  }

  get startCommand() {
    return this.config?.startCommand || "npm run start";
  }

  get buildCommand() {
    return this.config?.buildCommand;
  }
}
