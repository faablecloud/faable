import * as R from 'ramda'
import { StrategyFn, StrategyResolution } from './RuntimeStrategy'
import { has_any_of_files } from './helpers/has_any_of_files'
import { strategy_docker } from './strategies/docker'
import { strategy_nodejs } from './strategies/nodejs'
import { strategy_python } from './strategies/python'

export const runtime_detection = async (
  workdir: string
): Promise<StrategyResolution> => {
  const has = R.curry(has_any_of_files)
  // Order matters: node wins for full-stack apps that ship both a package.json
  // and Python deps; Dockerfile is the explicit escape hatch evaluated last.
  const strategy = R.cond<[string], StrategyFn>([
    [has(['package.json']), R.always(strategy_nodejs)],
    [
      has(['requirements.txt', 'pyproject.toml', 'Pipfile']),
      R.always(strategy_python)
    ],
    [has(['Dockerfile']), R.always(strategy_docker)]
  ])(workdir)

  if (!strategy) {
    throw new Error('Cannot detect project type')
  }

  return strategy(workdir)
}
