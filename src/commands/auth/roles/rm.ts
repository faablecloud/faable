import { CommandModule } from 'yargs'
import { requireAuthAdmin, withAuthHints } from '../../../api/auth_admin'
import { confirm } from '../../../lib/interactive'
import { log } from '../../../log'
import { TenantArgs, json_option, tenant_options } from '../options'
import { print_json } from '../render'
import { resolve_role_ref } from './shared'

interface RolesRmArgs extends TenantArgs {
  role: string
  yes?: boolean
}

export const roles_rm: CommandModule<unknown, RolesRmArgs> = {
  command: 'rm <role>',
  describe: 'Delete a role (its users lose its permissions)',
  builder: yargs =>
    json_option(tenant_options(yargs))
      .positional('role', {
        type: 'string',
        demandOption: true,
        description: 'Role id (role_…) or exact name'
      })
      .option('yes', {
        alias: 'y',
        type: 'boolean',
        default: false,
        description: 'Skip the confirmation prompt'
      })
      .showHelpOnFail(false) as any,
  handler: withAuthHints(async args => {
    const api = await requireAuthAdmin(args)
    const role = await resolve_role_ref(api, args.role)
    const go = await confirm({
      message: `Delete role ${role.name} (${role.id})? Everyone who holds it, directly or in a team, loses it.`,
      yes: args.yes
    })
    if (!go) {
      log.info('Cancelled.')
      return
    }
    await api.roleDelete(role.id)
    if (args.json) return print_json({ deleted: true, id: role.id })
    log.info(`🗑️ Deleted role ${role.name}.`)
  })
}
