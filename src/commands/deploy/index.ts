import { CommandModule } from 'yargs'
import { requireApi } from '../../api/context'
import { Configuration } from '../../lib/Configuration'
import { log } from '../../log'
import {
  buildpack_names,
  detect_buildpack,
  get_buildpack,
  plan_summary
} from './buildpacks'
import { check_environment } from './check_environment'
import { git_context } from './git_context'
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
    return yargs
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

    // app_id resolution (the user never has to look one up):
    //  1. explicit positional (monorepo escape hatch)
    //  2. OIDC in CI — the backend resolves the app from the linked repository
    //  3. locally — the app saved by `faable link` in faable.json
    const app_id = args.app_id || ctx.appId || Configuration.instance().app_id

    if (!app_id) {
      throw new Error(
        'No app linked to this repository. Run "faable link" to link it (or link it from the dashboard).'
      )
    }
    const app = await api.getApp(app_id)

    // Check if we can build docker images
    await check_environment()

    const runtime_label = plan.runtime.version
      ? `${plan.runtime.name}-${plan.runtime.version}`
      : plan.runtime.name
    log.info(`🚀 Deploying "${app.name}" (${app.id}) runtime=${runtime_label}`)
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

    // Capture the commit/ref/actor so the deployment records which commit it
    // came from and who pushed it (env in CI, git fallback locally).
    const git = await git_context({ workdir })

    // Create a deployment for this image
    const deployment = await api.createDeployment({
      app_id: app.id,
      image: upload_tagname,
      type,
      ...git
    })

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
