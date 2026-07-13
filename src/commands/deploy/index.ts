import { CommandModule } from 'yargs'
import { requireApi } from '../../api/context'
import { Configuration } from '../../lib/Configuration'
import { log } from '../../log'
import { link } from '../link'
import {
  buildpack_names,
  detect_buildpack,
  get_buildpack,
  plan_summary
} from './buildpacks'
import { check_environment } from './check_environment'
import { git_context } from './git_context'
import { resolve_app_id } from './resolve_app_id'
import { secrets } from './secrets'
import { mark_build_failure, start_log_sync, upload_logs } from './upload_logs'
import { upload_tag } from './upload_tag'

export interface DeployCommandArgs {
  app_id: string
  workdir?: string
  buildpack?: string
}

export const deploy: CommandModule<unknown, DeployCommandArgs> = {
  command: 'deploy [app_id]',
  describe: 'Deploy a faable app',
  builder: yargs => {
    // Product subcommands live under `deploy` (yargs matches them before the
    // app_id positional, so `faable deploy <app_id>` keeps working).
    return yargs
      .command(secrets)
      .command(link)
      .positional('app_id', {
        type: 'string',
        description: 'App Identifier'
      })
      .option('workdir', {
        alias: 'w',
        type: 'string',
        description: 'Working directory'
      })
      .option('buildpack', {
        alias: 'b',
        type: 'string',
        choices: buildpack_names(),
        description:
          'Force a specific buildpack (overrides auto-detection and faable.json)'
      })
      .showHelpOnFail(false) as any
  },

  handler: async args => {
    const workdir = args.workdir || process.cwd()

    const ctx = await requireApi()
    const { api } = ctx

    // Resolve the buildpack plan (detection or forced override). All the
    // build thinking happens here; build() below just executes the plan.
    const config = Configuration.instance().deployConfig()
    const plan = await detect_buildpack(
      { workdir, config },
      args.buildpack || config.buildpack
    )

    const app_id = await resolve_app_id(args.app_id, ctx.appId, api, workdir)
    const app = await api.getApp(app_id)

    // Capture the commit/ref/actor so the deployment records which commit
    // it came from and who pushed it (env in CI, git fallback locally).
    const git = await git_context({ workdir })

    // Create-first: register the deployment BEFORE building. Gate rejections
    // (free-plan quota 429, disabled app 409) surface here, at second 0 —
    // before any build minutes are spent. The row is born QUEUED; the CLI
    // owns it until the built image lands (or the build fails). `type` rides
    // on the create as before — the buildpack plan is already resolved.
    const deployment = await api.createDeployment({
      app_id: app.id,
      type: plan.type,
      ...git
    })

    try {
      // Check if we can build docker images
      await check_environment()

      const runtime_label = plan.runtime.version
        ? `${plan.runtime.name}-${plan.runtime.version}`
        : plan.runtime.name
      log.info(
        `🚀 Deploying "${app.name}" (${app.id}) runtime=${runtime_label}`
      )
      log.info(`🧩 Build plan ${plan_summary(plan)}`)

      // get environment variables
      const env_vars = await api.getAppSecrets(app.id)

      const buildpack = get_buildpack(plan.buildpack)
      if (!buildpack) {
        throw new Error(`No buildpack registered for plan=${plan.buildpack}`)
      }

      // The build starts now: declare it (QUEUED → BUILDING) and stream the
      // captured output to the deployment while it runs (best-effort).
      await api
        .updateDeploymentStatus(deployment.id, { phase: 'BUILDING' })
        .catch((error: any) =>
          log.warn(`Could not mark deployment BUILDING: ${error.message}`)
        )
      const stop_log_sync = start_log_sync(api, deployment.id)
      try {
        await buildpack.build({ workdir, config, app, env_vars }, plan)

        // Upload to Faable registry
        const { upload_tagname } = await upload_tag({ app, api })

        // Complete the deployment with the built image — this is the handoff:
        // the controller claims it and materializes the workload.
        await api.completeDeployment(deployment.id, upload_tagname)
      } finally {
        stop_log_sync()
      }
    } catch (error: any) {
      // The deployment already exists (created pre-build), so a failed build
      // marks THAT row BUILD_ERROR with the captured logs — no extra row, no
      // second quota hit. Gate rejections can't reach here anymore: the
      // create happens before any building.
      await mark_build_failure(api, { deployment_id: deployment.id, app })
      throw error
    }

    // Attach the final build output to the deployment (best-effort).
    await upload_logs(api, deployment.id)

    const dashboard_url = `https://dashboard.faable.com/deploy/${app.team}/app/${app.id}`
    log.info(`Preparing to deploy in faable cloud · ${deployment.id}`)
    log.info(`📊 View it in the dashboard -> ${dashboard_url}`)

    // Wait (up to 5 minutes) for the deployment to be promoted (live)
    const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
    const timeoutMs = 5 * 60 * 1000
    const intervalMs = 5000
    const start = Date.now()

    log.info(`⏳ Waiting for deployment to be promoted...`)

    let promoted = false
    while (Date.now() - start < timeoutMs) {
      await wait(intervalMs)
      try {
        const current = await api.getApp(app.id)
        if (current.status?.deployment === deployment.id) {
          promoted = true
          break
        }
      } catch (_error) {
        // Ignore transient errors while polling and keep waiting
        log.debug(`Polling app status failed, retrying...`)
      }
    }

    if (promoted) {
      log.info(`🌍 Deployment promoted and live, visit: https://${app.url}`)
    } else {
      log.warn(
        `⌛ Timed out after 5min waiting for promotion. The deployment is still rolling out, check the dashboard -> ${dashboard_url}`
      )
    }
  }
}
