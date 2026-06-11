import { CommandModule } from 'yargs'
import { requireApi } from '../../api/context'
import { cmd } from '../../lib/cmd'
import { Configuration } from '../../lib/Configuration'
import { log } from '../../log'
import { check_environment } from './check_environment'
import { git_context } from './git_context'
import { build_node } from './node-pipeline'
import { build_python } from './python-pipeline'
import { runtime_detection } from './runtime-detect/runtime_detection'
import { upload_tag } from './upload_tag'

export interface DeployCommandArgs {
  app_id: string
  workdir?: string
  project_type?: string
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
      .showHelpOnFail(false) as any
  },

  handler: async args => {
    const workdir = args.workdir || process.cwd()

    const ctx = await requireApi()
    const { api } = ctx

    // Resolve runtime
    const { runtime } = await runtime_detection(workdir)

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

    log.info(
      `🚀 Deploying "${app.name}" (${app.id}) runtime=${runtime.name}-${runtime.version}`
    )

    // get environment variables
    const env_vars = await api.getAppSecrets(app.id)

    let type

    if (runtime.name == 'node') {
      const node_result = await build_node(app, {
        workdir,
        runtime,
        env_vars
      })
      type = node_result.type
    } else if (runtime.name == 'python') {
      const python_result = await build_python(app, {
        workdir,
        runtime,
        env_vars
      })
      type = python_result.type
    } else if (runtime.name == 'docker') {
      type = 'node'
      await cmd(`docker build -t ${app.id} .`, {
        enableOutput: true
      })
    } else {
      throw new Error(`No build pipeline for runtime=${runtime.name}`)
    }

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
    log.info(`🌍 Deployment created (${deployment.id}) -> https://${app.url}`)
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
      log.info(`✅ Deployment promoted and live -> https://${app.url}`)
    } else {
      log.warn(
        `⌛ Timed out after 5min waiting for promotion. The deployment is still rolling out, check the dashboard -> ${dashboard_url}`
      )
    }
  }
}
