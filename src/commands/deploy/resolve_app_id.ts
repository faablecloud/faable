import { FaableApi } from '../../api/FaableApi'
import { requireProject } from '../../api/project'
import { Configuration } from '../../lib/Configuration'
import { CliError } from '../../lib/errors'
import { is_non_interactive } from '../../lib/interactive'
import { fetch_page } from '../../lib/listing'
import { getGitRemoteUrl } from '../../lib/git_remote'
import { log } from '../../log'

// --app takes an id, a name or a slug. An id (`app_…`) is used as-is — the
// api checks access on use. A name or slug is looked up among the apps of ONE
// project (--project, FAABLE_PROJECT, `faable project use`, or your only
// one) and must match exactly one: never across projects, where a staff
// session would see every customer's "dashboard" too.
export const resolve_app_ref = async (
  api: Pick<FaableApi, 'listApps' | 'listProjects'>,
  ref: string,
  // The project to search; by default the configured one (see above).
  in_project?: string
): Promise<string> => {
  if (ref.startsWith('app_')) return ref
  const project = in_project ?? (await requireProject(api)).id
  const apps = await fetch_page(p => api.listApps(p, project), {
    limit: 200,
    all: true
  })
  const wanted = ref.toLowerCase()
  const matches = apps.data.filter(
    a => a.name.toLowerCase() === wanted || a.slug?.toLowerCase() === wanted
  )
  if (matches.length === 1) return matches[0].id
  if (matches.length === 0) {
    throw new CliError(
      'not_found',
      `No app named "${ref}" in ${project}. See them with: faable deploy apps list`
    )
  }
  throw new CliError(
    'usage',
    `Several apps are named "${ref}": ${matches.map(a => a.id).join(', ')}. Use its id.`
  )
}

// app_id resolution (the user never has to look one up):
//  1. explicit (--app, on `deploy` and on every subcommand; id, name or slug)
//  2. OIDC in CI — the backend resolves the app from the linked repository
//  3. locally — a legacy app_id in faable.json (older CLIs wrote it on
//     `faable deploy link`; the current link only persists in the API)
//  4. locally — the app whose linked repository matches the git origin remote
//     of the working directory (repos are connected in the dashboard when the
//     app is created, or via `faable deploy link`)
//
// Non-interactive mode stops at 2: the working directory of a process a
// program spawned (the MCP server) says nothing about which app the user
// meant, and guessing from it is how a deploy lands on the wrong app.
//
// "No app here" is an answer, not an error — a bare `faable deploy` in an
// unlinked directory lists the subcommands instead of failing, and only the
// caller knows which of the two it wants. An AMBIGUOUS repository does throw:
// several apps is a question only the user can answer.
export const find_app_id = async (
  explicit: string | undefined,
  ctxAppId: string | undefined,
  api: FaableApi,
  workdir = process.cwd()
): Promise<string | null> => {
  if (explicit) return resolve_app_ref(api, explicit)
  if (is_non_interactive()) return ctxAppId || null
  const app_id = ctxAppId || Configuration.instance().app_id
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
        `Repository ${repository} is linked to several apps: ${ids}. Pass one with --app <app_id>.`
      )
    }
  }

  return null
}

// The same, for callers that have nothing to offer without an app.
export const resolve_app_id = async (
  explicit: string | undefined,
  ctxAppId: string | undefined,
  api: FaableApi,
  workdir = process.cwd()
): Promise<string> => {
  const app_id = await find_app_id(explicit, ctxAppId, api, workdir)
  if (app_id) return app_id

  throw new CliError(
    'app_required',
    is_non_interactive()
      ? 'Pass the app with --app <app_id> (non-interactive mode never infers it from the working directory).'
      : 'No app linked to this repository. Link it from the dashboard (or run "faable deploy link"), or pass one with --app <app_id>.'
  )
}
