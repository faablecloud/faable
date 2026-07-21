import { CommandModule } from 'yargs'
import { requireApi } from '../../api/context'
import { Configuration } from '../../lib/Configuration'
import { log } from '../../log'
import { link } from '../link'
import {
  BuildPlan,
  buildpack_names,
  configure_buildpacks,
  detect_buildpack,
  get_buildpack,
  plan_summary
} from '@faabletools/buildpacks'
import { cmd } from '../../lib/cmd'
import { check_environment } from './check_environment'
import { git_context } from './git_context'
import { deploy_remote } from './remote'
import { resolve_app_id } from './resolve_app_id'
import { secrets } from './secrets'
import { is_superseded } from './superseded'
import { mark_build_failure, start_log_sync, upload_logs } from './upload_logs'
import { upload_tag } from './upload_tag'

export interface DeployCommandArgs {
  app_id: string
  workdir?: string
  buildpack?: string
  remote?: boolean
  local?: boolean
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
      .option('remote', {
        type: 'boolean',
        description:
          'Build server-side (remote build), regardless of the app build_mode'
      })
      .option('local', {
        type: 'boolean',
        description:
          'Build locally with Docker, even if the app is set to remote builds'
      })
      .conflicts('remote', 'local')
      .showHelpOnFail(false) as any
  },

  handler: async args => {
    const workdir = args.workdir || process.cwd()

    // Wire the shared buildpacks package to the CLI's sinks: pino (which tees
    // into the build-log buffer) and cmd() (which captures subprocess output
    // into the same buffer). Must happen before any detect/build call.
    configure_buildpacks({ log, exec: cmd })

    const ctx = await requireApi()
    const { api } = ctx

    const config = Configuration.instance().deployConfig()

    const app_id = await resolve_app_id(args.app_id, ctx.appId, api, workdir)
    const app = await api.getApp(app_id)

    // Monorepo Root Directory: the server is the source of truth
    // (App.root_dir), so no repo config file is needed. A local
    // faable.json rootDir (dev override) still wins if set.
    if (!config.rootDir && app.root_dir) {
      config.rootDir = app.root_dir
      log.info(`📁 Monorepo root directory (from app): ${app.root_dir}`)
    }

    // Capture the commit/ref/actor so the deployment records which commit
    // it came from and who pushed it (env in CI, git fallback locally).
    const git = await git_context({ workdir })

    // Resolve the buildpack plan (detection or forced override). All the build
    // thinking happens here; build() below just executes the plan. Detection can
    // fail (e.g. an app whose start command can't be inferred) — and it runs
    // before the create-first deployment exists, so without this a detection
    // failure would leave NO deployment row: no deploy-failed email, nothing in
    // the dashboard, just a red X in the CI logs the user may never see. Record
    // it as a failed deployment instead.
    let plan: BuildPlan
    try {
      plan = await detect_buildpack(
        { workdir, config },
        args.buildpack || config.buildpack
      )
    } catch (error: any) {
      // Log the reason into the build buffer first (so it rides along in the
      // attached logs), then record a typeless BUILD_ERROR row — typeless so it
      // can't rewrite the app's runtime_strategy. Best-effort: a create that
      // itself fails (e.g. the free-plan quota gate) must not mask the original
      // detection error.
      log.error(error.message)
      const failed = await api
        .createDeployment({ app_id: app.id, ...git })
        .catch(() => null)
      if (failed) {
        await mark_build_failure(api, { deployment_id: failed.id, app })
      }
      throw error
    }

    // Remote build path (v2, arch/deploy/deploy-v2-remote-build.md): the
    // server decides via the app's build_mode; --remote/--local override for
    // testing. Pre-build failures with a server-decided mode fall back to the
    // local build below (deploy_remote returns null); with --remote they
    // fail hard.
    let deployment: { id: string }
    const want_remote =
      !args.local && (Boolean(args.remote) || app.build_mode === 'remote')
    const remote_deployment = want_remote
      ? await deploy_remote({
          api,
          app,
          plan,
          git,
          workdir,
          explicit: Boolean(args.remote)
        })
      : null

    if (remote_deployment) {
      deployment = remote_deployment
    } else {
      if (want_remote) {
        log.warn('↩️ Falling back to a local build')
      }

    // Create-first: register the deployment BEFORE building. Gate rejections
    // (free-plan quota 429, disabled app 409) surface here, at second 0 —
    // before any build minutes are spent. The row is born QUEUED; the CLI
    // owns it until the built image lands (or the build fails). `type` rides
    // on the create — the buildpack plan is already resolved.
    deployment = await api.createDeployment({
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
        await buildpack.build({ workdir, config, app, env_vars, deployment }, plan)

        // Upload to Faable registry, tagged by version and pinned to digest
        const { image_ref } = await upload_tag({
          app,
          api,
          deployment_id: deployment.id
        })

        // Complete the deployment with the built image — this is the handoff:
        // the controller claims it and materializes the workload.
        await api.completeDeployment(deployment.id, image_ref)
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
    } // end local build path (remote builds upload their own logs server-side)

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
    let failure: { phase: string; reason?: string } | null = null
    let superseded: string | null = null
    // The pointer at wait-start is the PREVIOUS deployment (older than ours)
    // — only a pointer CHANGE to something that isn't us needs a look.
    const initialActiveId = app.status?.deployment
    while (Date.now() - start < timeoutMs) {
      await wait(intervalMs)
      try {
        const current = await api.getApp(app.id)
        if (current.status?.deployment === deployment.id) {
          promoted = true
          break
        }
        // Superseded: the pointer moved to a deployment at least as new as
        // ours (twin workflows on the same push, or a rapid follow-up
        // deploy). It only moves forward — waiting longer can never succeed.
        const activeId = current.status?.deployment
        if (activeId && activeId !== initialActiveId) {
          const active = await api.getDeployment(activeId).catch(() => null)
          if (
            active &&
            is_superseded(
              deployment as { id: string; createdAt: string },
              active as { id: string; createdAt: string }
            )
          ) {
            superseded = activeId
            break
          }
        }
        // Watch for a terminal runtime failure so we fail fast (and red)
        // instead of timing out green. The controller marks a crash-looping
        // deployment ERROR — with a reason (e.g. a missing module) — within
        // ~1min, long before this 5min promotion timeout.
        const dep = await api.getDeployment(deployment.id)
        const phase = dep.status?.phase
        if (phase === "ERROR" || phase === "BUILD_ERROR") {
          failure = { phase, reason: dep.status?.reason }
          break
        }
        // CANCELED: the platform superseded this build before it produced a
        // runnable (a sibling deployment of the app won the promotion).
        if (phase === "CANCELED") {
          superseded = dep.status?.reason ?? "canceled"
          break
        }
      } catch (_error) {
        // Ignore transient errors while polling and keep waiting
        log.debug(`Polling app status failed, retrying...`)
      }
    }

    if (promoted) {
      log.info(`🌍 Deployment promoted and live, visit: https://${app.url}`)
    } else if (superseded) {
      // Not a failure: the app IS live, just on a sibling deployment (e.g.
      // duplicated workflows firing on the same push). Green exit — there is
      // nothing for the user to fix in THIS run.
      log.warn(
        `⚠️ Deployment superseded — a newer deployment of this app was promoted (${superseded}). The app is live: https://${app.url}`
      )
    } else if (failure) {
      // Fail the command (non-zero exit → red GitHub Action) and surface the
      // reason the controller captured so the user sees WHY without digging.
      log.error(`❌ Deployment failed (${failure.phase}).`)
      if (failure.reason) log.error(failure.reason)
      log.error(`Check the logs in the dashboard -> ${dashboard_url}`)
      throw new Error(
        `Deployment ${deployment.id} failed with phase ${failure.phase}`
      )
    } else {
      log.warn(
        `⌛ Timed out after 5min waiting for promotion. The deployment is still rolling out, check the dashboard -> ${dashboard_url}`
      )
    }
  }
}
