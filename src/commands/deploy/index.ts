import { CommandModule } from 'yargs'
import { requireApi } from '../../api/context'
import { Configuration } from '../../lib/Configuration'
import { log } from '../../log'
import { link } from '../link'
import { git_context } from './git_context'
import { deploy_remote } from './remote'
import { resolve_app_id } from './resolve_app_id'
import { secrets } from './secrets'
import { is_superseded } from './superseded'

export interface DeployCommandArgs {
  app_id: string
  workdir?: string
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
      .showHelpOnFail(false) as any
  },

  handler: async args => {
    const workdir = args.workdir || process.cwd()

    // Pass the explicit app target to the OIDC exchange so a monorepo (several
    // apps, one repo) can be disambiguated in CI.
    const ctx = await requireApi(args.app_id)
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

    // Remote build only (arch/deploy/remote-artifact-default-cutover.md): the
    // CLI no longer builds — it uploads the source and the platform builds
    // server-side (framework detection, buildpacks, artifact/image output all
    // live in the builder). No Docker, no local fallback: a rejected admission
    // (build_mode=local opt-out, or the global kill-switch off) or a build
    // error throws and exits red.
    log.info(`🚀 Deploying "${app.name}" (${app.id})`)
    const deployment = await deploy_remote({ api, app, git, workdir })

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
