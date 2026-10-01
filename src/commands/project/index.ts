import { CommandModule } from 'yargs'
import { requireSessionToken, subject } from '../../api/auth_admin'
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

const project_use: CommandModule<unknown, { project: string }> = {
  command: 'use <project>',
  describe: 'Set the active project (id, name or slug)',
  builder: yargs =>
    yargs
      .positional('project', { type: 'string', demandOption: true })
      .example('$0 project use project_6a8ebd6160324d4631c12edc', 'By id')
      .example('$0 project use "Faable Staff"', 'By name')
      .showHelpOnFail(false) as any,
  handler: async args => {
    const { api } = await requireApi()
    const id = await resolveProjectRef(api, args.project)
    // Fetching it is the membership check: the api 404s a project you can't see.
    const project = await api.getProject(id)
    await new ContextStore().update(ctx => ({ ...ctx, project: project.id }))
    log.info(`✅ Active project: ${project.name} (${project.id})`)
  }
}

const project_current: CommandModule<unknown, { json?: boolean }> = {
  command: 'current',
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
  describe: 'Choose the project the CLI acts on (list, use, current)',
  builder: yargs =>
    yargs
      .command(project_list)
      .command(project_use)
      .command(project_current)
      .demandCommand(1)
      .showHelpOnFail(false) as any,
  handler: () => {}
}
