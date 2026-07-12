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
import { report_build_failure, upload_logs } from './upload_logs'
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

    // From here on there is an app to attach logs to: any build/push failure
    // is recorded as a BUILD_ERROR deployment with the captured output.
    let deployment: { id: string }
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
      await buildpack.build({ workdir, config, app, env_vars }, plan)
      const type = plan.type

      // Upload to Faable registry
      const { upload_tagname } = await upload_tag({ app, api })

      // Capture the commit/ref/actor so the deployment records which commit
      // it came from and who pushed it (env in CI, git fallback locally).
      const git = await git_context({ workdir })

      // Create a deployment for this image
      deployment = await api.createDeployment({
        app_id: app.id,
        image: upload_tagname,
        type,
        ...git
      })
    } catch (error: any) {
      // A free-plan quota rejection (429 deployment_quota_exceeded) is not a
      // build failure — the build itself succeeded. Skip the failure report
      // so the app doesn't show a red build; the API's message (with the
      // upgrade hint) still reaches the user via the error printer.
      const isQuotaRejection =
        error?.isFaableApiError &&
        error?.response?.status === 429 &&
        error?.response?.data?.code === 'deployment_quota_exceeded'
      if (!isQuotaRejection) {
        await report_build_failure(api, { app, workdir })
      }
      throw error
    }

    // Attach the build output to the deployment (best-effort).
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
