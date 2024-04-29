import { strategy_nodejs } from "./strategies/nodejs";
import * as R from "ramda";
import { has_any_of_files } from "./helpers/has_any_of_files";
import { strategy_python } from "./strategies/python";
import { StrategyResolution, StrategyFn } from "./RuntimeStrategy";
import { strategy_docker } from "./strategies/docker";

export const runtime_detection = async (
  workdir: string
): Promise<StrategyResolution> => {
  const has = R.curry(has_any_of_files);
  const strategy = R.cond<[string], StrategyFn>([
    [has(["package.json"]), R.always(strategy_nodejs)],
    // [has(["requirements.txt"]), R.always(strategy_python)],
    [has(["Dockerfile"]), R.always(strategy_docker)],
  ])(workdir);

  if (!strategy) {
    throw new Error("Cannot detect project type");
  }

  return strategy(workdir);
};
