import { CommandModule } from 'yargs'
import { requireApi } from '../../../api/context'
import { json_option, print_json } from '../../../lib/listing'
import { log } from '../../../log'
import { resolve_app_id } from '../resolve_app_id'

const MODES = ['push', 'ci', 'workflow'] as const

interface AppsSetArgs {
  app?: string
  branch?: string
  rootDir?: string
  mode?: (typeof MODES)[number]
  gitlabProject?: string
  json?: boolean
}

// `faable deploy apps set` — how an app deploys from its repository: the
// branch, the monorepo Root Directory and the trigger. The same three
// settings as the dashboard's repository card; nothing redeploys by itself,
// the next push (or `faable deploy trigger`) uses them.
export const apps_set: CommandModule<unknown, AppsSetArgs> = {
  command: 'set',
  describe: 'Change how the app deploys: branch, root directory, trigger',
  builder: yargs =>
    json_option(yargs)
      .option('app', {
        alias: 'a',
        type: 'string',
        description: 'App id, name or slug (defaults to the linked app)'
      })
      .option('branch', {
        alias: 'b',
        type: 'string',
        description: 'Branch to deploy from'
      })
      .option('root-dir', {
        type: 'string',
        description:
          'Monorepo Root Directory, inside the repository ("" clears it: faable.json rootDir applies again)'
      })
      .option('mode', {
        type: 'string',
        choices: MODES,
        description:
          'push: every push deploys · ci: once CI tags a release · workflow: your own GitHub workflow runs faable deploy'
      })
      .option('gitlab-project', {
        type: 'string',
        description:
          'GitLab project ID (the number on its page) whose CI may deploy this app without an API key ("" revokes it)'
      })
      .check(({ branch, rootDir, mode, gitlabProject }: any) => {
        if (
          branch === undefined &&
          rootDir === undefined &&
          mode === undefined &&
          gitlabProject === undefined
        ) {
          throw new Error(
            'Nothing to change: pass --branch, --root-dir, --mode or --gitlab-project.'
          )
        }
        if (gitlabProject && !/^[0-9]+$/.test(String(gitlabProject))) {
          throw new Error(
            '--gitlab-project takes the numeric Project ID shown on the GitLab project page, not its path.'
          )
        }
        return true
      })
      .example('$0 deploy apps set --branch release', 'Deploy from "release"')
      .example('$0 deploy apps set --root-dir apps/web', 'A monorepo app')
      .example(
        '$0 deploy apps set --gitlab-project 12345678',
        'Let that GitLab project deploy keyless'
      )
      .showHelpOnFail(false) as any,
  handler: async args => {
    const ctx = await requireApi()
    const app_id = await resolve_app_id(args.app, ctx.appId, ctx.api)

    // One setting at a time, each its own endpoint (and its own guards).
    if (args.branch !== undefined) {
      await ctx.api.setDeployBranch(app_id, args.branch)
      log.info(`🌿 Deploy branch: ${args.branch}`)
    }
    if (args.rootDir !== undefined) {
      await ctx.api.setRootDir(app_id, args.rootDir || null)
      log.info(
        args.rootDir
          ? `📁 Root directory: ${args.rootDir}`
          : '📁 Root directory cleared (faable.json rootDir applies again)'
      )
    }
    if (args.mode !== undefined) {
      await ctx.api.setDeployMode(app_id, args.mode)
      log.info(`⚙️ Deploy mode: ${args.mode}`)
    }

    if (args.gitlabProject !== undefined) {
      await ctx.api.setCiTrust(app_id, String(args.gitlabProject) || null)
      log.info(
        args.gitlabProject
          ? `🦊 GitLab project ${args.gitlabProject} can deploy this app without an API key`
          : '🦊 GitLab keyless deploys revoked'
      )
    }

    const app = await ctx.api.getApp(app_id)
    if (args.json) return print_json(app)
    log.info(
      `Applies to the next deploy of ${app.name}. Start one now with: faable deploy trigger -a ${app.id}`
    )
  }
}
