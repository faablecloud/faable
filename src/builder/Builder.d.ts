import { FaableApp } from "../api/FaableApi";

type BuilderContext = {
  app: FaableApp;
  workdir: string;
  runtime: Runtime;
};

export type Builder = (ctx: BuilderContext) => Promise<object>;
