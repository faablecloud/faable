import { CommandModule } from 'yargs'
import { requireApi } from '../../../api/context'
import { log } from '../../../log'
import { resolve_app_id } from '../resolve_app_id'

// Mirrors CANCELABLE_PHASES in the api (deployment/api/cancel.ts). Used only
// to pick a default target; the api is the one that enforces it, so a phase
// that changed between the list and the call is still refused server-side.
const IN_FLIGHT_PHASES = new Set(['UNKNOWN', 'QUEUED', 'BUILDING'])

interface CancelArgs {
  deployment?: string
  app?: string
}

export const cancel: CommandModule<unknown, CancelArgs> = {
  command: 'cancel [deployment]',
  describe: 'Stop a deployment that is still queued or building',
  builder: yargs =>
    yargs
      .positional('deployment', {
        type: 'string',
        description:
          'Deployment id to cancel (defaults to the one currently in flight)'
      })
      .option('app', {
        alias: 'a',
        type: 'string',
        description: 'App Identifier (defaults to the linked app)'
      })
      .example('$0 deploy cancel', 'Stop the build that is running right now')
      .showHelpOnFail(false) as any,
  handler: async args => {
    const ctx = await requireApi()
    const app_id = await resolve_app_id(args.app, ctx.appId, ctx.api)
    const app = await ctx.api.getApp(app_id)

    let deployment_id = args.deployment
    if (!deployment_id) {
      const rows = await ctx.api.listDeployments(app_id, app.team)
      const inFlight = rows.find(d =>
        IN_FLIGHT_PHASES.has(d.status?.phase ?? '')
      )
      if (!inFlight) {
        log.info(`✅ Nothing building for ${app.name} — nothing to cancel.`)
        return
      }
      deployment_id = inFlight.id
    }

    // The api owns the guards: it refuses once a controller has claimed the
    // deployment, and answers a repeated cancel with the same 200 so a retry
    // is never an error the user has to read.
    const canceled = await ctx.api.cancelDeployment(deployment_id, app.team)
    log.info(`🛑 Canceled ${canceled.id} (${app.name}).`)
    log.info(
      `Production keeps serving the last promoted deployment. Deploy again with: faable deploy`
    )
  }
}
