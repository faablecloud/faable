import { StrategyFn } from "../RuntimeStrategy";

export const strategy_docker: StrategyFn = async (_workdir: string) => {
  return {
    runtime: {
      name: "docker",
    },
  };
};
