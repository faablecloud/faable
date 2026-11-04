import { CommandModule } from 'yargs'
import { FaableApi, FaableOrganization } from '../../api/FaableApi'
import { requireApi } from '../../api/context'
import { requireProject, resolveProjectRef } from '../../api/project'
import { CliError } from '../../lib/errors'
import { confirm } from '../../lib/interactive'
import { json_option, print, print_json, table_lines } from '../../lib/listing'
import { log } from '../../log'

// `faable organization` — the companies that group projects. An organization
// gives nobody access to its projects and is not billed. The api decides who
// may: its admins and the projects' owners, or staff; a person, never an API
// key (`Organizations are managed by people`).

const ID_RE = /^organization_[0-9a-f]{24}$/

const resolveOrganization = async (
  api: Pick<FaableApi, 'listOrganizations'>,
  ref: string
): Promise<string> => {
  if (ID_RE.test(ref)) return ref
  const wanted = ref.toLowerCase()
  const { results } = await api.listOrganizations()
  const matches = results.filter(
    o => o.name.toLowerCase() === wanted || o.slug.toLowerCase() === wanted
  )
  if (matches.length === 1) return matches[0].id
  throw new CliError(
    'not_found',
    matches.length === 0
      ? `No organization named "${ref}". See them with: faable organization list`
      : `"${ref}" is more than one organization: use its id.`
  )
}

const project_names = (o: FaableOrganization) =>
  o.projects.map(p => p.name).join(', ') || '-'

const organization_list: CommandModule<unknown, { json?: boolean }> = {
  command: 'list',
  describe: 'List the organizations you administer or have a project in',
  builder: yargs => json_option(yargs).showHelpOnFail(false) as any,
  handler: async args => {
    const { api } = await requireApi()
    const { results } = await api.listOrganizations()
    if (args.json) return print_json(results)
    if (results.length === 0) return log.info('📭 No organizations.')
    for (const line of table_lines(
      ['ID', 'NAME', 'ADMIN', 'PROJECTS'],
      results.map(o => [
        o.id,
        o.name,
        o.is_admin ? 'yes' : 'no',
        project_names(o)
      ])
    )) {
      print(line)
    }
  }
}

const organization_get: CommandModule<
  unknown,
  { organization: string; json?: boolean }
> = {
  command: 'get <organization>',
  describe: 'Show an organization: its projects and admins',
  builder: yargs =>
    json_option(yargs)
      .positional('organization', { type: 'string', demandOption: true })
      .showHelpOnFail(false) as any,
  handler: async args => {
    const { api } = await requireApi()
    const org = await api.getOrganization(
      await resolveOrganization(api, args.organization)
    )
    if (args.json) return print_json(org)
    print(`${org.name} (${org.id})`)
    print(`Projects: ${project_names(org)}`)
    print(`Admins:   ${org.admins?.join(', ') || '-'}`)
  }
}

const organization_create: CommandModule<
  unknown,
  { name: string; json?: boolean }
> = {
  command: 'create <name>',
  describe:
    'Create an organization from a project (--project or the active one); you become its admin',
  builder: yargs =>
    json_option(yargs)
      .positional('name', { type: 'string', demandOption: true })
      .example('$0 organization create "Acme SL" --project acme-web', '')
      .showHelpOnFail(false) as any,
  handler: async args => {
    const { api } = await requireApi()
    const { id } = await requireProject(api)
    const org = await api.createOrganization(args.name, id)
    if (args.json) return print_json(org)
    log.info(`✅ Organization ${org.name} (${org.id})`)
  }
}

interface ProjectArgs {
  organization: string
  project_ref: string
  yes?: boolean
}

const project_positionals = (yargs: any) =>
  yargs
    .positional('organization', { type: 'string', demandOption: true })
    .positional('project_ref', {
      type: 'string',
      demandOption: true,
      describe: 'Project id, name or slug'
    })

const projects_add: CommandModule<unknown, ProjectArgs> = {
  command: 'add <organization> <project_ref>',
  describe: 'Put a project in the organization (moves it from any other)',
  builder: yargs => project_positionals(yargs).showHelpOnFail(false),
  handler: async args => {
    const { api } = await requireApi()
    const id = await resolveOrganization(api, args.organization)
    const project = await resolveProjectRef(api, args.project_ref)
    await api.addOrganizationProject(id, project)
    log.info(`✅ ${args.project_ref} is in ${args.organization}`)
  }
}

const projects_rm: CommandModule<unknown, ProjectArgs> = {
  command: 'rm <organization> <project_ref>',
  describe: 'Take a project out of the organization: it becomes personal',
  builder: yargs =>
    project_positionals(yargs)
      .option('yes', {
        type: 'boolean',
        alias: 'y',
        description: 'Skip the confirmation prompt'
      })
      .showHelpOnFail(false),
  handler: async args => {
    const { api } = await requireApi()
    const id = await resolveOrganization(api, args.organization)
    const project = await resolveProjectRef(api, args.project_ref)
    const go = await confirm({
      message: `Take ${args.project_ref} out of ${args.organization}?`,
      yes: args.yes
    })
    if (!go) return log.info('Cancelled.')
    await api.removeOrganizationProject(id, project)
    log.info(`✅ ${args.project_ref} is no longer in ${args.organization}`)
  }
}

const organization_projects: CommandModule = {
  command: 'projects',
  describe: "Add or remove an organization's projects",
  builder: yargs =>
    yargs
      .command(projects_add)
      .command(projects_rm)
      .demandCommand(1)
      .showHelpOnFail(false) as any,
  handler: () => {}
}

interface AdminArgs {
  organization: string
  user_id: string
  yes?: boolean
}

const admin_positionals = (yargs: any) =>
  yargs
    .positional('organization', { type: 'string', demandOption: true })
    .positional('user_id', { type: 'string', demandOption: true })

const admins_add: CommandModule<unknown, AdminArgs> = {
  command: 'add <organization> <user_id>',
  describe: 'Make someone an admin (gives no access to its projects)',
  builder: yargs => admin_positionals(yargs).showHelpOnFail(false),
  handler: async args => {
    const { api } = await requireApi()
    const id = await resolveOrganization(api, args.organization)
    await api.addOrganizationAdmin(id, args.user_id)
    log.info(`✅ ${args.user_id} administers ${args.organization}`)
  }
}

const admins_rm: CommandModule<unknown, AdminArgs> = {
  command: 'rm <organization> <user_id>',
  describe: 'Remove an admin (an organization keeps at least one)',
  builder: yargs =>
    admin_positionals(yargs)
      .option('yes', {
        type: 'boolean',
        alias: 'y',
        description: 'Skip the confirmation prompt'
      })
      .showHelpOnFail(false),
  handler: async args => {
    const { api } = await requireApi()
    const id = await resolveOrganization(api, args.organization)
    const go = await confirm({
      message: `Remove ${args.user_id} as admin of ${args.organization}?`,
      yes: args.yes
    })
    if (!go) return log.info('Cancelled.')
    await api.removeOrganizationAdmin(id, args.user_id)
    log.info(`✅ ${args.user_id} no longer administers ${args.organization}`)
  }
}

const organization_admins: CommandModule = {
  command: 'admins',
  describe: "Add or remove an organization's admins",
  builder: yargs =>
    yargs
      .command(admins_add)
      .command(admins_rm)
      .demandCommand(1)
      .showHelpOnFail(false) as any,
  handler: () => {}
}

export const organization: CommandModule = {
  command: ['organization', 'org'],
  describe: 'Group projects under a company (list, get, create, projects, admins)',
  builder: yargs =>
    yargs
      .command(organization_list)
      .command(organization_get)
      .command(organization_create)
      .command(organization_projects)
      .command(organization_admins)
      .demandCommand(1)
      .showHelpOnFail(false) as any,
  handler: () => {}
}
