import { CommandModule } from 'yargs'
import { requireApi } from '../../../api/context'
import { json_option, print_json } from '../../../lib/listing'
import { log } from '../../../log'
import { resolve_app_id } from '../resolve_app_id'

interface TriggerArgs {
  app?: string
  json?: boolean
}

export const trigger: CommandModule<unknown, TriggerArgs> = {
  command: 'trigger',
  describe: 'Build and deploy the latest commit of the deploy branch, server-side',
  builder: yargs =>
    json_option(yargs)
      .option('app', {
        alias: 'a',
        type: 'string',
        description: 'App id, name or slug (defaults to the linked app)'
      })
      .example(
        '$0 deploy trigger',
        'Deploy the repo HEAD without uploading anything from this machine'
      )
      .showHelpOnFail(false) as any,
  handler: async args => {
    const ctx = await requireApi()
    const app_id = await resolve_app_id(args.app, ctx.appId, ctx.api)
    const app = await ctx.api.getApp(app_id)

    // Takes the exact same path a git push would (same-commit dedupe
    // included) — the API answers with an actionable refusal otherwise.
    const result = await ctx.api.deployNow(app_id, app.team)
    if (args.json) return print_json({ app_id, ...result })
    log.info(
      `🚀 Building ${result.commit.slice(0, 7)} (${result.branch}) of ${app.name} server-side${
        result.deployment_id ? ` as ${result.deployment_id}` : ''
      }.`
    )
    if (result.deployment_id) {
      log.info(
        `Follow the build: faable deploy logs --build -d ${result.deployment_id} -a ${app.id} --follow`
      )
    }
    log.info(
      `Track it with: faable deploy status -a ${app.id}  ·  or in the dashboard: https://dashboard.faable.com/deploy/${app.team}/app/${app.id}`
    )
  }
}
