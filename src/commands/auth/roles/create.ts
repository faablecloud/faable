import { CommandModule } from 'yargs'
import { requireAuthAdmin, withAuthHints } from '../../../api/auth_admin'
import { CliError } from '../../../lib/errors'
import { log } from '../../../log'
import { TenantArgs, json_option, tenant_options } from '../options'
import { print_json } from '../render'

interface RolesCreateArgs extends TenantArgs {
  role?: string
  name?: string
  description?: string
}

export const roles_create: CommandModule<unknown, RolesCreateArgs> = {
  // `[name]` or `--name=…`: the MCP tool passes it glued, since a name may
  // start with "-".
  command: 'create [role]',
  describe: 'Create a role',
  builder: yargs =>
    json_option(tenant_options(yargs))
      .positional('role', {
        type: 'string',
        description: 'Role name, e.g. support or invites-staff'
      })
      .option('name', {
        type: 'string',
        description: 'The role name, as a flag (for a name that starts with -)'
      })
      .option('description', {
        alias: 'd',
        type: 'string',
        description: 'What users with this role do'
      })
      .example(
        '$0 auth roles create support -d "Support staff"',
        'Create a role, then give it permissions with `roles permissions`'
      )
      .showHelpOnFail(false) as any,
  handler: withAuthHints(async args => {
    const name = args.name ?? args.role
    if (!name) throw new CliError('usage', 'Pass the role name.')
    const api = await requireAuthAdmin(args)
    const role = (await api.roleCreate({
      name,
      ...(args.description ? { description: args.description } : {})
    } as any)) as any
    if (args.json) return print_json(role)
    log.info(`✅ Created role ${role.name} (${role.id}).`)
    log.info(
      `   Give it permissions: faable auth roles permissions ${role.name} --api <api> --add <permission>`
    )
  })
}
