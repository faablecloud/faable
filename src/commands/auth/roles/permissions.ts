import { CommandModule } from 'yargs'
import { requireAuthAdmin, withAuthHints } from '../../../api/auth_admin'
import { CliError } from '../../../lib/errors'
import { log } from '../../../log'
import { TenantArgs, json_option, tenant_options } from '../options'
import { print_json } from '../render'
import { RolePermissionRow, resolve_api_ref, resolve_role_ref } from './shared'

interface RolesPermissionsArgs extends TenantArgs {
  role: string
  api?: string
  add?: string[]
  rm?: string[]
}

export const roles_permissions: CommandModule<unknown, RolesPermissionsArgs> = {
  command: 'permissions <role>',
  describe: "List a role's permissions, or add / remove permissions of one API",
  builder: yargs =>
    json_option(tenant_options(yargs))
      .positional('role', {
        type: 'string',
        demandOption: true,
        description: 'Role id (role_…) or exact name'
      })
      .option('api', {
        type: 'string',
        description:
          'API whose permissions --add / --rm name: id (api_…) or identifier (audience URL)'
      })
      .option('add', {
        type: 'string',
        array: true,
        description: "Permission to grant (from the API's catalog) — repeatable"
      })
      .option('rm', {
        type: 'string',
        array: true,
        description: 'Permission to revoke — repeatable'
      })
      .example(
        '$0 auth roles permissions support --api https://api.example.com --add tickets:read --add tickets:write',
        'Grant two permissions of one API'
      )
      .example(
        '$0 auth roles permissions support',
        "List the role's permissions"
      )
      .showHelpOnFail(false) as any,
  handler: withAuthHints(async args => {
    const add = args.add ?? []
    const rm = args.rm ?? []
    if ((add.length || rm.length) && !args.api) {
      throw new CliError(
        'usage',
        '--add / --rm need --api <id or identifier>: a permission belongs to one API.'
      )
    }
    const api = await requireAuthAdmin(args)
    const role = await resolve_role_ref(api, args.role)
    if (add.length || rm.length) {
      const target = await resolve_api_ref(api, args.api!)
      const ref = (value: string) => ({ api: target.id, value })
      if (add.length) {
        await api.roleAddPermissions(role.id, {
          permissions: add.map(ref)
        } as any)
      }
      if (rm.length) {
        await api.roleRemovePermissions(role.id, {
          permissions: rm.map(ref)
        } as any)
      }
      if (!args.json) {
        log.info(
          `✅ ${role.name}: ${[
            add.length ? `+${add.join(', +')}` : '',
            rm.length ? `-${rm.join(', -')}` : ''
          ]
            .filter(Boolean)
            .join(
              ' '
            )} on ${target.name}. Tokens issued from now on (refreshes included) reflect it.`
        )
      }
    }
    const permissions = (await api.rolePermissions(
      role.id
    )) as unknown as RolePermissionRow[]
    if (args.json) return print_json(permissions)
    if (permissions.length === 0) {
      log.info(`📭 ${role.name} grants no permissions.`)
      return
    }
    log.info(`🔑 ${role.name} grants ${permissions.length} permission(s):`)
    for (const p of permissions) {
      log.info(`  ${p.value}  — ${p.api_name} (${p.api_identifier})`)
    }
  })
}
