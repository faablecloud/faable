import prompts from 'prompts'
import type { FaableApi, FaableProject } from '../../api/FaableApi'

// `faable project use` with no argument: an interactive picker. Type to
// filter by name, slug or id.
//
// What it offers: every project you belong to when they fit in one page —
// the case for a customer. A staff session sees the whole platform in
// GET /project, so there it starts from the projects you own and searches
// the rest on the server as you type.

type Api = Pick<FaableApi, 'listProjects'>

export interface Candidates {
  projects: FaableProject[]
  // The listing didn't fit: typing searches the server too.
  search_remote: boolean
}

export const pickCandidates = async (
  api: Api,
  user_id?: string
): Promise<Candidates> => {
  const page = await api.listProjects({ pageSize: 200 })
  if (!page.next) return { projects: page.results, search_remote: false }
  const mine = user_id
    ? (await api.listProjects({ pageSize: 200, user_id })).results
    : []
  return { projects: mine, search_remote: true }
}

export const matches = (p: FaableProject, input: string) => {
  const q = input.trim().toLowerCase()
  if (!q) return true
  return [p.name, p.slug, p.id].some(v => v?.toLowerCase().includes(q))
}

const title = (p: FaableProject, active?: string) =>
  `${p.id === active ? '● ' : '  '}${p.name}  ${p.slug ?? p.id}`

type Choice = { title: string; value: string }

export const pickProject = async (
  api: Api,
  { user_id, active }: { user_id?: string; active?: string }
): Promise<string | undefined> => {
  const { projects, search_remote } = await pickCandidates(api, user_id)
  if (projects.length === 0 && !search_remote) {
    throw new Error(
      'You have no projects yet. Create one in the dashboard (https://dashboard.faable.com).'
    )
  }
  const as_choice = (p: FaableProject): Choice => ({
    title: title(p, active),
    value: p.id
  })
  // The active project first: Enter keeps it, and it's where you look.
  const ordered = [
    ...projects.filter(p => p.id === active),
    ...projects.filter(p => p.id !== active)
  ]

  const { project } = await prompts({
    type: 'autocomplete',
    name: 'project',
    message: search_remote
      ? 'Project (yours listed; type to search all)'
      : 'Project (type to filter)',
    limit: 15,
    choices: ordered.map(as_choice),
    suggest: async (input: string) => {
      const local = ordered.filter(p => matches(p, input))
      if (!search_remote || input.trim().length < 2) return local.map(as_choice)
      const remote = await api
        .listProjects({ q: input.trim(), pageSize: 20 })
        .then(r => r.results)
        .catch(() => [] as FaableProject[])
      const seen = new Set(local.map(p => p.id))
      return [...local, ...remote.filter(p => !seen.has(p.id))].map(as_choice)
    }
  })
  return project
}
