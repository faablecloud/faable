import path from "path";
import fs from "fs-extra";
import { log } from "../log";
interface ProjectConfig {
  startCommand?: string;
  buildCommand?: string;
  /** Force a specific buildpack (node | python | docker) instead of auto-detection. */
  buildpack?: string;
  /** Monorepo Root Directory (dev override; server-side App.root_dir is the source of truth). */
  rootDir?: string;
  /** Next.js knobs. `standalone: false` opts out of the standalone image profile (remote builds). */
  next?: { standalone?: boolean };
  app_slug?: string;
  app_id?:string
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

  /** Start command explicitly set in faable.json, or undefined when relying on the default. */
  get configuredStartCommand() {
    return this.config.startCommand;
  }

  get buildCommand() {
    return this.config.buildCommand;
  }

  /**
   * faable.json subset consumed by the deploy buildpacks. Buildpacks receive
   * this via their context and never touch the singleton directly.
   */
  deployConfig() {
    return {
      startCommand: this.config.startCommand,
      buildCommand: this.config.buildCommand,
      buildpack: this.config.buildpack,
      rootDir: this.config.rootDir,
      next: this.config.next,
    };
  }

  get app_slug() {
    return this.config.app_slug;
  }
  get app_id() {
    return this.config.app_id;
  }
}
