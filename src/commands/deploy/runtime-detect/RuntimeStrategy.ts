export type FaableRuntime = "node" | "python" | "docker";

export interface StrategyResolution {
  app_name?: string;
  runtime: FaableRuntime;
  runtime_version: string;
}

export type StrategyFn = (workdir: string) => Promise<StrategyResolution>;
