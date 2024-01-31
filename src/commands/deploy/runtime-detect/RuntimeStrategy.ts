export type FaableRuntime = "node" | "python" | "docker";

export type Runtime = {
  name: FaableRuntime;
  version?: string;
};

export interface StrategyResolution {
  app_name?: string;
  runtime: Runtime;
}

export type StrategyFn = (workdir: string) => Promise<StrategyResolution>;
