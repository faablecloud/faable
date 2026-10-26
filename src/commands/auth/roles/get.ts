import { CommandModule } from 'yargs'
import { requireAuthAdmin, withAuthHints } from '../../../api/auth_admin'
import { log } from '../../../log'
import { TenantArgs, json_option, tenant_options } from '../options'
import { print_json } from '../render'
import { RolePermissionRow, resolve_role_ref } from './shared'

interface RolesGetArgs extends TenantArgs {
  role: string
}

export const roles_get: CommandModule<unknown, RolesGetArgs> = {
  command: 'get <role>',
  describe: 'Show a role: its permissions and the users it is assigned to',
  builder: yargs =>
    json_option(tenant_options(yargs))
      .positional('role', {
        type: 'string',
        demandOption: true,
        description: 'Role id (role_…) or exact name'
      })
      .showHelpOnFail(false) as any,
  handler: withAuthHints(async args => {
    const api = await requireAuthAdmin(args)
    const role = await resolve_role_ref(api, args.role)
    const permissions = (await api.rolePermissions(
      role.id
    )) as unknown as RolePermissionRow[]
    const grants = await api
      .roleUsers(role.id, {} as never)
      .pass({ pageSize: '100' } as never)
    const users = ((grants.results ?? []) as any[]).map(g =>
      typeof g.user === 'object'
        ? { id: g.user.id, email: g.user.email }
        : { id: g.user }
    )
    if (args.json) return print_json({ ...role, permissions, users })

    log.info(`🎭 ${role.name} (${role.id})`)
    if (role.description) log.info(`  ${role.description}`)
    log.info(`  Permissions (${permissions.length}):`)
    for (const p of permissions) {
      log.info(`    ${p.value}  — ${p.api_name} (${p.api_identifier})`)
    }
    log.info(`  Users (${users.length}${grants.next ? '+' : ''}):`)
    for (const u of users)
      log.info(`    ${u.id}${u.email ? `  ${u.email}` : ''}`)
  })
}
