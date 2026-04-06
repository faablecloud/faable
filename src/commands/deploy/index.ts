import { CommandModule } from 'yargs'
import { FaableApp } from '../../api/FaableApi'
import { context } from '../../api/context'
import { cmd } from '../../lib/cmd'
import { log } from '../../log'
import { check_environment } from './check_environment'
import { build_node } from './node-pipeline'
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

    const ctx = await context()
    const { api } = ctx

    // Resolve runtime
    const { runtime } = await runtime_detection(workdir)

    let app: FaableApp | undefined
    if (args.app_id) {
      app = await api.getApp(args.app_id)
    } else {
      if (ctx.appId) {
        app = await api.getApp(ctx.appId)
      }
    }

    if (!app) {
      throw new Error('Missing <app_id>')
    }

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

    // Create a deployment for this image
    await api.createDeployment({ app_id: app.id, image: upload_tagname, type })
    log.info(`🌍 Deployment created -> https://${app.url}`)
  }
}
