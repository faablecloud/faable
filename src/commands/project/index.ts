import { CommandModule } from 'yargs'
import { requireSessionToken, subject } from '../../api/auth_admin'
import { loadLiveCredentials } from '../../api/session'
import { requireApi } from '../../api/context'
import {
  SOURCE_LABEL,
  configuredProject,
  requireProject,
  resolveProjectRef
} from '../../api/project'
import { ContextStore } from '../../lib/ContextStore'
import {
  ListArgs,
  fetch_page,
  json_option,
  list_options,
  more_hint,
  print,
  print_json,
  table_lines
} from '../../lib/listing'
import { log } from '../../log'
import { pickProject } from './picker'

// `faable project` — which project the CLI acts on. Project-wide commands
// (`deploy list`, `faable auth …`) use the active one; --project <id|name> or
// FAABLE_PROJECT override it for one call.

interface ProjectListArgs extends ListArgs {
  q?: string
  mine?: boolean
}

const project_list: CommandModule<unknown, ProjectListArgs> = {
  command: 'list',
  describe: 'List your projects',
  builder: yargs =>
    list_options(yargs)
      .option('q', {
        type: 'string',
        description: 'Search by name, slug or description'
      })
      .option('mine', {
        type: 'boolean',
        default: false,
        description:
          'Only the projects you own (a staff session otherwise lists every project)'
      })
      .showHelpOnFail(false) as any,
  handler: async args => {
    const { api } = await requireApi()
    const user_id = args.mine ? subject(await requireSessionToken()) : undefined
    if (args.mine && !user_id) {
      throw new Error('--mine needs a `faable login` session (or FAABLE_TOKEN).')
    }
    const page = await fetch_page(
      p => api.listProjects({ ...p, q: args.q, user_id }),
      args
    )
    if (args.json) return print_json(page)

    if (page.data.length === 0) {
      log.info('📭 No projects.')
      return
    }
    const active = api.project
    log.info(`📁 ${page.data.length} project(s):`)
    for (const line of table_lines(
      ['', 'ID', 'NAME', 'SLUG'],
      page.data.map(p => [p.id === active ? '*' : '', p.id, p.name, p.slug ?? '-'])
    )) {
      print(line)
    }
    const hint = more_hint(page)
    if (hint) log.info(hint)
  }
}

const project_use: CommandModule<unknown, { project?: string }> = {
  command: 'use [project]',
  describe: 'Set the active project — id, name or slug; none to pick from a list; - for the previous one',
  builder: yargs =>
    yargs
      .positional('project', { type: 'string' })
      .example('$0 project use', 'Pick from your projects (type to filter)')
      .example('$0 project use "Faable Staff"', 'By name')
      .example('$0 project use project_6a8ebd6160324d4631c12edc', 'By id')
      .example('$0 project use -', 'Back to the previous project')
      .showHelpOnFail(false) as any,
  handler: async args => {
    const { api } = await requireApi()
    const store = new ContextStore()
    const ctx = await store.load()

    // yargs never hands over a lone `-` as the positional (it parses it as a
    // flag-like `true`), so read it off the raw arguments.
    const previous = args.project === '-' || process.argv.slice(2).includes('-')
    const ref = typeof args.project === 'string' ? args.project : undefined

    let id: string | undefined
    if (previous) {
      if (!ctx.previous) throw new Error('No previous project to go back to.')
      id = ctx.previous.id
    } else if (ref) {
      id = await resolveProjectRef(api, ref)
    } else {
      if (!process.stdin.isTTY || !process.stderr.isTTY) {
        throw new Error(
          'Name the project: faable project use <id|name> (the picker needs a terminal).'
        )
      }
      const token = process.env.FAABLE_TOKEN || (await loadLiveCredentials())?.token
      id = await pickProject(api, {
        user_id: token ? subject(token) : undefined,
        active: ctx.project
      })
      if (!id) return log.info('Cancelled; the active project is unchanged.')
    }

    // Fetching it is the membership check: the api 404s a project you can't see.
    const project = await api.getProject(id)
    await store.update(c => ({
      ...c,
      project: project.id,
      project_name: project.name,
      // Re-selecting the active one keeps the real previous one for `use -`.
      previous:
        c.project && c.project !== project.id
          ? { id: c.project, name: c.project_name }
          : c.previous
    }))
    log.info(`✅ Active project: ${project.name} (${project.id})`)
  }
}

const project_clear: CommandModule = {
  command: 'clear',
  describe: 'Forget the active project',
  builder: yargs => yargs.showHelpOnFail(false) as any,
  handler: async () => {
    await new ContextStore().update(c => {
      const { project, project_name, ...rest } = c
      return project ? { ...rest, previous: { id: project, name: project_name } } : rest
    })
    log.info('Active project cleared. Commands now need --project, FAABLE_PROJECT or faable project use.')
  }
}

const project_current: CommandModule<unknown, { json?: boolean }> = {
  // Also what a bare `faable project` shows.
  command: ['current', '$0'],
  describe: 'Show the active project and where it comes from',
  builder: yargs => json_option(yargs).showHelpOnFail(false) as any,
  handler: async args => {
    const { api } = await requireApi()
    const configured = await configuredProject()
    const { id, source } = await requireProject(api)
    const project = await api.getProject(id)
    const out = {
      id: project.id,
      name: project.name,
      slug: project.slug ?? null,
      source: configured?.source ?? source
    }
    if (args.json) return print_json(out)
    print(`${project.name} (${project.id})`)
    log.info(`from ${SOURCE_LABEL[out.source]}`)
  }
}

export const project: CommandModule = {
  command: 'project',
  describe: 'Show or change the project the CLI acts on (list, use, clear)',
  builder: yargs =>
    yargs
      .command(project_list)
      .command(project_use)
      .command(project_clear)
      .command(project_current)
      .showHelpOnFail(false) as any,
  handler: () => {}
}
