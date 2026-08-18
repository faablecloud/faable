import path from "path";
import fs from "fs-extra";
import { log } from "../log";
interface ProjectConfig {
  startCommand?: string;
  buildCommand?: string;
  /** Force a specific buildpack (node | python | docker) instead of auto-detection. */
  buildpack?: string;
  /** Monorepo Root Directory (the supported user option; a platform-managed App.root_dir override wins). */
  rootDir?: string;
  /** Next.js knobs. `standalone: false` opts out of the standalone image profile (remote builds). */
  next?: { standalone?: boolean };
  /** Legacy: older CLIs wrote these on `faable link`. Still honored when
   * present, but the link now lives only in the API (app.repository). */
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

  get app_id() {
    return this.config.app_id;
  }
}
