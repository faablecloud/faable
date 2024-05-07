import { Configuration } from "lib/Configuration";
import { FaableApp } from "../api/FaableApi";
import { Logger } from "pino";

type BuilderContext = {
  app: FaableApp;
  workdir: string;
  log: Logger;
  config: Configuration;
};

type BuilderResult = {
  dockerfile: string;
  params?: object;
};

export type Builder = (ctx: BuilderContext) => Promise<BuilderResult>;
