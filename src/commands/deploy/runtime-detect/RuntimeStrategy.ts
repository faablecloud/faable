export type FaableRuntime = "node" | "python" | "docker";

export interface StrategyResolution {
  app_name?: string;
  runtime: FaableRuntime;
}

export type StrategyFn = (workdir: string) => Promise<StrategyResolution>;
