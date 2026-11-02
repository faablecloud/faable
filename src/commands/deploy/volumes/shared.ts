import { Argv } from 'yargs'
import type { FaableVolume } from '../../../api/FaableApi'
import { CliError } from '../../../lib/errors'
import { resolve_app } from '../schedule/shared'

export { app_option } from '../schedule/shared'

export const volume_option = <T>(yargs: Argv<T>) =>
  yargs.option('volume', {
    type: 'string',
    description:
      'Volume name or id, when the app has more than one (a WordPress app has one: site)'
  })

export const wait_option = <T>(yargs: Argv<T>) =>
  yargs.option('wait', {
    type: 'boolean',
    default: true,
    description: 'Wait until it finishes (--no-wait to only queue it)'
  })

/** The app, and the one of its volumes the command acts on. */
export const resolve_volume = async (app?: string, volume?: string) => {
  const ctx = await resolve_app(app)
  const { results } = await ctx.api.listVolumes(ctx.team, ctx.app_id)
  if (results.length === 0) {
    throw new CliError(
      'not_found',
      `${ctx.app.name} has no volumes: only apps created from a blueprint (WordPress) have one today`
    )
  }
  let found: FaableVolume | undefined
  if (volume) {
    found = results.find(v => v.id === volume || v.name === volume)
    if (!found) {
      throw new CliError(
        'not_found',
        `${ctx.app.name} has no volume ${volume}; it has: ${results.map(v => v.name).join(', ')}`
      )
    }
  } else if (results.length > 1) {
    throw new CliError(
      'usage',
      `${ctx.app.name} has ${results.length} volumes: say which with --volume (${results.map(v => v.name).join(', ')})`
    )
  } else {
    found = results[0]
  }
  return { ...ctx, volume: found }
}

export {
  format_bytes,
  format_usage,
  require_completed,
  state_label,
  wait_operation
} from './operation'
