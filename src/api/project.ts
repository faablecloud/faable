import { ContextStore } from '../lib/ContextStore'
import { CliError } from '../lib/errors'
import type { FaableApi, FaableProject } from './FaableApi'

// Which project a command acts on, in precedence order:
//
//   1. --project / -p   (global flag; id or name)
//   2. FAABLE_PROJECT   (env; id or name)
//   3. `faable project use` (~/.faable/config.json; always an id)
//
// The flag and the env are per call, so a script — or the MCP server driving
// this CLI — never depends on (or races over) the stored one.

export type ProjectSource = 'flag' | 'env' | 'config' | 'only'

export interface ProjectRef {
  ref: string
  source: ProjectSource
}

let flag_value: string | undefined

// Set by the global middleware in src/index.ts.
export const setProjectFlag = (value: string | undefined) => {
  flag_value = value || undefined
}

export const configuredProject = async (
  store = new ContextStore(),
  env = process.env
): Promise<ProjectRef | undefined> => {
  if (flag_value) return { ref: flag_value, source: 'flag' }
  if (env.FAABLE_PROJECT) return { ref: env.FAABLE_PROJECT, source: 'env' }
  const { project } = await store.load()
  if (project) return { ref: project, source: 'config' }
  return undefined
}

const ID_RE = /^(project|team)_[a-f0-9]{24}$/

// project_<hex>: the api's form. A team_<hex> (the app rows' form) is the
// same project.
export const toProjectId = (id: string) => id.replace(/^team_/, 'project_')

// An id is taken as-is (the api checks membership on use); a name or slug is
// looked up — exactly one project must match.
export const resolveProjectRef = async (
  api: Pick<FaableApi, 'listProjects'>,
  ref: string
): Promise<string> => {
  if (ID_RE.test(ref)) return toProjectId(ref)
  const page = await api.listProjects({ q: ref, pageSize: 50 })
  const wanted = ref.toLowerCase()
  const matches = page.results.filter(
    p => p.name.toLowerCase() === wanted || p.slug?.toLowerCase() === wanted
  )
  if (matches.length === 1) return matches[0].id
  if (matches.length === 0) {
    throw new Error(
      `No project named "${ref}". See them with: faable project list`
    )
  }
  throw new Error(
    `Several projects are named "${ref}": ${describe(matches)}. Use its id.`
  )
}

const describe = (projects: FaableProject[]) =>
  projects.map(p => `${p.name} (${p.id})`).join(', ')

// The project a project-wide command needs. With none configured, a caller
// who belongs to exactly one project gets that one; otherwise it's an error
// that says how to choose.
export const requireProject = async (
  api: Pick<FaableApi, 'listProjects'>,
  store = new ContextStore(),
  env = process.env
): Promise<{ id: string; source: ProjectSource }> => {
  const configured = await configuredProject(store, env)
  if (configured) {
    return {
      id: await resolveProjectRef(api, configured.ref),
      source: configured.source
    }
  }
  const page = await api.listProjects({ pageSize: 2 })
  if (page.results.length === 1 && !page.next) {
    return { id: page.results[0].id, source: 'only' }
  }
  throw new CliError(
    'project_required',
    'No project selected. Pick one with: faable project use <id|name> (list them with: faable project list), or pass --project <id|name>.'
  )
}

export const SOURCE_LABEL: Record<ProjectSource, string> = {
  flag: '--project',
  env: 'FAABLE_PROJECT',
  config: 'faable project use',
  only: 'your only project'
}
