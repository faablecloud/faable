import { Argv } from 'yargs'
import { requireApi } from '../../../api/context'
import { resolve_app_id } from '../resolve_app_id'

export const app_option = <T>(yargs: Argv<T>) =>
  yargs.option('app', {
    alias: 'a',
    type: 'string',
    description: 'App id, name or slug (defaults to the linked app)'
  })

/** The app the command acts on, with the project its calls go to. */
export const resolve_app = async (app?: string) => {
  const ctx = await requireApi()
  const app_id = await resolve_app_id(app, ctx.appId, ctx.api)
  const found = await ctx.api.getApp(app_id)
  return { api: ctx.api, app_id, app: found, team: found.team }
}
