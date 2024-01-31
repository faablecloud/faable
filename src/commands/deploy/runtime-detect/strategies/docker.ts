import { StrategyFn } from "../RuntimeStrategy";

export const strategy_docker: StrategyFn = async (workdir: string) => {
  return {
    runtime: {
      name: "docker",
    },
  };
};
