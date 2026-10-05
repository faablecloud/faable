import { CommandModule } from 'yargs'
import { FaableApp } from '../../../api/FaableApi'
import { requireApi } from '../../../api/context'
import { requireProject } from '../../../api/project'
import { CliError } from '../../../lib/errors'
import { json_option, print_json } from '../../../lib/listing'
import { log } from '../../../log'
import { WaitResult, app_url, wait_for_deployment } from '../wait'

interface AppsCreateArgs {
  repo?: string
  name?: string
  description?: string
  branch?: string
  deploy?: boolean
  json?: boolean
  wait?: boolean
  timeout?: number
}

// "owner/repo" from any of the ways people paste a GitHub repository.
export const parse_repo = (input: string): string => {
  const cleaned = input
    .trim()
    .replace(/^git@github\.com:/, '')
    .replace(/^(https?:\/\/)?(www\.)?github\.com\//, '')
    .replace(/\.git$/, '')
    .replace(/\/+$/, '')
  if (!/^[\w.-]+\/[\w.-]+$/.test(cleaned)) {
    throw new CliError(
      'usage',
      `"${input}" is not a GitHub repository — use owner/repo.`
    )
  }
  return cleaned
}

type FirstDeploy =
  | { commit: string; branch: string; deployment_id?: string }
  | { refused: string; message: string }
  | null

// `faable deploy apps create` — the dashboard's "Create & connect", same
// sequence (components/apps/deploy/app/app-create/AppCreateForm.tsx):
// create the app in the project, link the repository, and start the first
// deploy, because linking alone deploys nothing (deploy v4) and a new app
// that waits for a push is one that never deploys.
//
// One difference, on purpose: when the link fails, the app THIS call just
// created is deleted again. The dashboard can leave it — its app page offers
// to retry the link — but here the retry is running this command again, and
// every failed attempt would leave an empty app behind. Nothing that existed
// before the command is ever touched.
export const apps_create: CommandModule<unknown, AppsCreateArgs> = {
  command: 'create',
  describe: 'Create an app from a GitHub repository and start its first deploy',
  builder: yargs =>
    json_option(yargs)
      .option('repo', {
        alias: 'r',
        type: 'string',
        description: 'GitHub repository (owner/repo or its URL)'
      })
      .option('name', {
        alias: 'n',
        type: 'string',
        description: 'App name (defaults to the repository name)'
      })
      .option('description', {
        type: 'string',
        description: 'App description'
      })
      .option('branch', {
        alias: 'b',
        type: 'string',
        description: 'Branch to deploy (defaults to the repository default)'
      })
      .option('deploy', {
        type: 'boolean',
        default: true,
        description: 'Start the first deploy (--no-deploy to only link)'
      })
      .option('wait', {
        type: 'boolean',
        default: false,
        description:
          'Wait until the deploy is live or fails, and print the URL (or why it failed)'
      })
      .option('timeout', {
        type: 'number',
        default: 900,
        description: 'With --wait: give up waiting after this many seconds (the build goes on)'
      })
      .check(({ repo, name }: any) => {
        if (!repo && !name) {
          throw new Error(
            'Give the repository (--repo owner/repo), or --name for an app without one.'
          )
        }
        return true
      })
      .example(
        '$0 deploy apps create --repo acme/web',
        'Create "web" from acme/web and deploy its default branch'
      )
      .example(
        '$0 deploy apps create --repo acme/mono --name api --branch release',
        'Another app from a monorepo, deploying another branch'
      )
      .showHelpOnFail(false) as any,
  handler: async args => {
    const repository = args.repo ? parse_repo(args.repo) : undefined
    const name = args.name || repository!.split('/')[1]
    const { api } = await requireApi()
    const { id: project } = await requireProject(api)

    const app = await api.createApp(project, {
      name,
      ...(args.description ? { description: args.description } : {})
    })
    log.info(`📦 Created ${app.name} (${app.id})`)

    let linked: FaableApp = app
    if (repository) {
      try {
        linked = await api.linkRepository(
          app.id,
          {
            repository,
            ...(args.branch ? { github_branch: args.branch } : {})
          },
          app.team
        )
      } catch (err) {
        await api.deleteApp(app.id, app.team).catch(() => {
          log.warn(
            `Could not remove ${app.id} after the failed link — delete it from the dashboard.`
          )
        })
        const e = err as Error & {
          code?: string
          status?: number
          action?: string
        }
        const failed = new CliError(
          'usage',
          `Could not link ${repository}, so ${app.name} was not kept: ${e.message}`,
          { status: e.status, action: e.action, cause: err }
        )
        // The api's reason (github_installation_missing, repository_already_linked…)
        // is the useful code; ours would only say "something failed".
        if (e.code) failed.code = e.code
        throw failed
      }
      log.info(
        `🔗 Linked ${repository} (${linked.github_branch ?? 'default branch'})`
      )
    }

    // Only push-to-deploy apps: a repository that brings its own Faable
    // workflow deploys from the user's CI, and deploy_now would refuse.
    let first_deploy: FirstDeploy = null
    if (repository && args.deploy && linked.deploy_trigger === 'webhook') {
      try {
        const started = await api.deployNow(app.id, app.team)
        first_deploy = {
          commit: started.commit,
          branch: started.branch,
          ...(started.deployment_id
            ? { deployment_id: started.deployment_id }
            : {})
        }
        log.info(
          `🚀 First deploy: building ${started.commit.slice(0, 7)} from ${started.branch}`
        )
      } catch (err) {
        // Not a failure of the create: an empty repository or a missing
        // branch is something to tell, and the app is there either way.
        const e = err as Error & { code?: string }
        first_deploy = {
          refused: e.code ?? 'deploy_refused',
          message: e.message
        }
        log.warn(
          `⚠️ The app is ready but the first deploy did not start: ${e.message}`
        )
      }
    }

    let waited: WaitResult | undefined
    if (
      args.wait &&
      first_deploy &&
      'deployment_id' in first_deploy &&
      first_deploy.deployment_id
    ) {
      waited = await wait_for_deployment(api, first_deploy.deployment_id, {
        timeout_s: args.timeout ?? 900,
        app_url: app_url(linked.url)
      })
      if (!args.json) {
        log.info(
          waited.ok
            ? `✅ Live: ${waited.url}`
            : waited.done
              ? `❌ ${waited.phase}${waited.fault_owner ? ` (${waited.fault_owner})` : ''}: ${waited.reason ?? ''}`
              : `⏳ Still ${waited.phase} after ${args.timeout}s`
        )
      }
    }

    if (args.json) {
      return print_json({
        app: linked,
        first_deploy,
        ...(waited ? { result: waited } : {})
      })
    }
    log.info(
      `🌍 https://${linked.url}  ·  follow it with: faable deploy status -a ${app.id}`
    )
  }
}
