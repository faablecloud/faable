import { FaableApi } from '../../api/FaableApi'
import { Configuration } from '../../lib/Configuration'
import { getGitRemoteUrl } from '../../lib/git_remote'
import { log } from '../../log'

// app_id resolution (the user never has to look one up):
//  1. explicit (positional on `deploy`, --app on subcommands)
//  2. OIDC in CI — the backend resolves the app from the linked repository
//  3. locally — the app saved by `faable deploy link` in faable.json
//  4. locally — the app whose linked repository matches the git origin remote
//     of the working directory (repos are connected in the dashboard when the
//     app is created, so most working copies never ran `link`)
export const resolve_app_id = async (
  explicit: string | undefined,
  ctxAppId: string | undefined,
  api: FaableApi,
  workdir = process.cwd()
): Promise<string> => {
  const app_id = explicit || ctxAppId || Configuration.instance().app_id
  if (app_id) return app_id

  const repository = await getGitRemoteUrl(workdir)
  if (repository) {
    const apps = await api.list()
    const matches = apps.filter(app => app.repository === repository)
    if (matches.length === 1) {
      const app = matches[0]
      log.info(`🔎 Detected app "${app.name}" (${app.id}) from repository ${repository}`)
      return app.id
    }
    if (matches.length > 1) {
      const ids = matches.map(app => `${app.name} (${app.id})`).join(', ')
      throw new Error(
        `Repository ${repository} is linked to several apps: ${ids}. Pass the app explicitly.`
      )
    }
  }

  throw new Error(
    'No app linked to this repository. Link it from the dashboard (or run "faable deploy link"), or pass the app explicitly.'
  )
}
