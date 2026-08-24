import { CommandModule } from 'yargs'
import { FaableArtifact } from '../../../api/FaableApi'
import { requireApi } from '../../../api/context'
import { log } from '../../../log'
import { resolve_app_id } from '../resolve_app_id'
import { deployment_detail } from './detail'

interface InspectArgs {
  deployment?: string
  app?: string
  json?: boolean
}

export const inspect: CommandModule<unknown, InspectArgs> = {
  command: 'inspect [deployment]',
  describe: 'Show everything recorded about one deployment',
  builder: yargs =>
    yargs
      .positional('deployment', {
        type: 'string',
        description: 'Deployment id (defaults to the latest one of the app)'
      })
      .option('app', {
        alias: 'a',
        type: 'string',
        description: 'App Identifier (defaults to the linked app)'
      })
      .option('json', {
        type: 'boolean',
        default: false,
        description: 'Output raw JSON (for scripting)'
      })
      .example(
        '$0 deploy inspect deployment_a1b2c3',
        'Everything about that deployment: phase, commit, artifact, failure reason'
      )
      .example('$0 deploy inspect', 'Same, for the latest deployment')
      .showHelpOnFail(false) as any,
  handler: async args => {
    const ctx = await requireApi()
    const app_id = await resolve_app_id(args.app, ctx.appId, ctx.api)
    const app = await ctx.api.getApp(app_id)

    let deployment_id = args.deployment
    if (!deployment_id) {
      const rows = await ctx.api.listDeployments(app_id, app.team)
      deployment_id = rows[0]?.id
      if (!deployment_id) {
        log.info(`📭 ${app.name} has no deployments yet.`)
        return
      }
    }

    const deployment = await ctx.api.getDeployment(deployment_id)

    // A deployment id is globally unique but the app comes from the link/--app
    // flag: refuse to render one against the wrong app instead of printing a
    // mismatched "Serving"/"App" header.
    if (deployment.app_id && deployment.app_id !== app_id) {
      throw new Error(
        `${deployment_id} belongs to another app (${deployment.app_id}), not ${app.name} (${app_id}). Pass --app ${deployment.app_id}.`
      )
    }

    // The runnable descriptor (runtime, profile, size) lives on the artifact
    // row. Absent on image deploys, and a purged/expired row must not break
    // the read — the rest of the record is still worth showing.
    let artifact: FaableArtifact | null = null
    if (deployment.artifact_id) {
      artifact = await ctx.api.getArtifact(deployment.artifact_id).catch(() => {
        log.debug(`Could not read artifact ${deployment.artifact_id}`)
        return null
      })
    }

    if (args.json) {
      process.stdout.write(
        JSON.stringify({ ...deployment, artifact }, null, 2) + '\n'
      )
      return
    }

    for (const line of deployment_detail({ app, deployment, artifact })) {
      log.info(line)
    }
  }
}
