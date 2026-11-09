import { FaableApi, FaableApp, FaableDomain } from '../../../api/FaableApi'
import { requireProject } from '../../../api/project'
import { CliError } from '../../../lib/errors'
import { fetch_page } from '../../../lib/listing'
import { find_app_id } from '../resolve_app_id'
import { find_by_fqdn } from './format'

type DomainsApi = Pick<FaableApi, 'listDomainsPage'>

// A domain is the PROJECT's, not the app's: deleting an app unlinks its domains
// and leaves them in the project with no app (api deploy/domain/lifecycle.ts).
// So a domain is looked up in the whole project, never only in one app's list —
// that is how `rm` and `check` could not see app.ciapol.com (2026-11-09).
export const project_domains = async (api: DomainsApi, team: string) =>
  (
    await fetch_page(p => api.listDomainsPage(undefined, team, p), {
      limit: 200,
      all: true
    })
  ).data

export const find_project_domain = async (
  api: DomainsApi,
  team: string,
  fqdn: string
): Promise<FaableDomain | undefined> =>
  find_by_fqdn(await project_domains(api, team), fqdn)

export const not_in_project = (fqdn: string, team: string) =>
  new CliError(
    'not_found',
    `Domain ${fqdn} is not in project ${team}. List them with "faable deploy domains list".`
  )

/**
 * The domain `fqdn` of the project. With an app, it must be that app's — or
 * linked to no app, which any app may act on: there is no other app to name.
 */
export const locate_domain = async (
  api: DomainsApi,
  team: string,
  fqdn: string,
  app_id: string | null
): Promise<FaableDomain> => {
  const domain = await find_project_domain(api, team, fqdn)
  if (!domain) throw not_in_project(fqdn, team)
  if (app_id && domain.app_id && domain.app_id !== app_id) {
    throw new CliError(
      'not_found',
      `Domain ${domain.fqdn} is attached to ${domain.app_id}, not to ${app_id}. Run the command with --app ${domain.app_id}, or move it with "faable deploy domains attach ${domain.fqdn} --app ${app_id}".`
    )
  }
  return domain
}

export type AttachPlan =
  | { kind: 'already'; domain: FaableDomain }
  | { kind: 'link'; domain: FaableDomain; from: string | null }

// What `attach` does with the domain it found.
export const attach_plan = (
  domain: FaableDomain,
  app_id: string
): AttachPlan =>
  domain.app_id === app_id
    ? { kind: 'already', domain }
    : { kind: 'link', domain, from: domain.app_id ?? null }

// `domains add` on a hostname the project already has: say which command fixes
// it. The api says so too from `domain_unlinked` on; this also covers an older
// api, which answers the same anonymous `domain_taken` to everyone.
export const add_conflict_hint = async (
  api: DomainsApi,
  team: string,
  fqdn: string,
  app_id: string,
  err: unknown
): Promise<CliError | undefined> => {
  const code = (err as { code?: string } | undefined)?.code
  if (code !== 'domain_taken' && code !== 'domain_unlinked') return undefined
  const domain = await find_project_domain(api, team, fqdn).catch(
    () => undefined
  )
  if (!domain) return undefined
  if (domain.app_id === app_id) {
    return new CliError(
      'domain_taken',
      `Domain ${domain.fqdn} is already attached to ${app_id}. See it with "faable deploy domains check ${domain.fqdn} --app ${app_id}".`,
      { status: 409, cause: err }
    )
  }
  return domain.app_id
    ? new CliError(
        'domain_taken',
        `Domain ${domain.fqdn} is already in this project, attached to ${domain.app_id}. Move it with: faable deploy domains attach ${domain.fqdn} --app ${app_id}`,
        { status: 409, cause: err }
      )
    : new CliError(
        'domain_unlinked',
        `Domain ${domain.fqdn} is already in this project, linked to no app. Link it — its CNAME and certificate stay valid — with: faable deploy domains attach ${domain.fqdn} --app ${app_id}`,
        { status: 409, cause: err }
      )
}

/**
 * Where a domain command acts: the project of the app (`--app`, or the one the
 * directory is linked to), else the active project (`--project`). `explicit`
 * is the app the user NAMED — only that one restricts which domain matches; an
 * app inferred from the directory just says which project.
 */
export const domain_scope = async (
  api: FaableApi,
  app_ref: string | undefined,
  ctx_app_id: string | undefined
): Promise<{
  team: string
  app: FaableApp | null
  explicit: string | null
}> => {
  const app_id = await find_app_id(app_ref, ctx_app_id, api)
  if (app_id) {
    const app = await api.getApp(app_id)
    return { team: app.team, app, explicit: app_ref ? app_id : null }
  }
  const { id } = await requireProject(api)
  return { team: id, app: null, explicit: null }
}
