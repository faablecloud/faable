import { CommandModule } from 'yargs'
import { requireApi } from '../../../api/context'
import { json_option, print_json, print_noop } from '../../../lib/listing'
import { log } from '../../../log'
import { resolve_app_id } from '../resolve_app_id'

const FAILED_PHASES = new Set(['ERROR', 'BUILD_ERROR'])

interface RedeployArgs {
  deployment?: string
  app?: string
  json?: boolean
}

export const redeploy: CommandModule<unknown, RedeployArgs> = {
  command: 'redeploy [deployment]',
  describe: 'Rebuild a failed deployment from its recorded source',
  builder: yargs =>
    json_option(yargs)
      .positional('deployment', {
        type: 'string',
        description:
          'Deployment id to rebuild (defaults to the latest failed one)'
      })
      .option('app', {
        alias: 'a',
        type: 'string',
        description: 'App Identifier (defaults to the linked app)'
      })
      .example('$0 deploy redeploy', 'Retry the latest failed deployment')
      .showHelpOnFail(false) as any,
  handler: async args => {
    const ctx = await requireApi()
    const app_id = await resolve_app_id(args.app, ctx.appId, ctx.api)
    const app = await ctx.api.getApp(app_id)

    let deployment_id = args.deployment
    if (!deployment_id) {
      const rows = await ctx.api.listDeployments(app_id, app.team)
      const failed = rows.find(d => FAILED_PHASES.has(d.status?.phase ?? ''))
      if (!failed) {
        if (args.json) {
          return print_noop(`${app.name} has no failed deployment to retry`)
        }
        log.info(
          `✅ No failed deployments to retry for ${app.name}. To rebuild the repo HEAD use: faable deploy trigger`
        )
        return
      }
      deployment_id = failed.id
    }

    // The API enforces the guards (failed phase only, never older than what
    // production serves) and answers with an actionable refusal otherwise.
    const clone = await ctx.api.redeployDeployment(deployment_id, app.team)
    if (args.json) return print_json(clone)
    log.info(`🔁 Rebuilding ${deployment_id} as ${clone.id}.`)
    // With -a: these lines get copied, and outside the app's checkout a
    // bare command resolves no app (see next_steps in detail.ts).
    log.info(
      `Track it with: faable deploy status -a ${app.id}  ·  build output: faable deploy logs --build -d ${clone.id} -a ${app.id}`
    )
  }
}
