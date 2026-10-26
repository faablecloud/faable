import { CommandModule } from 'yargs'
import { requireAuthAdmin, withAuthHints } from '../../../api/auth_admin'
import { log } from '../../../log'
import { TenantArgs, json_option, tenant_options } from '../options'
import { print_json } from '../render'
import { resolve_user_ref } from './resolve'

interface UsersPermissionsArgs extends TenantArgs {
  user: string
}

export const users_permissions: CommandModule<unknown, UsersPermissionsArgs> = {
  command: 'permissions <user>',
  describe:
    "What a user's roles grant, per API, and which role gives each permission",
  builder: yargs =>
    json_option(tenant_options(yargs))
      .positional('user', {
        type: 'string',
        demandOption: true,
        description: 'User id (user_…) or exact email'
      })
      .showHelpOnFail(false) as any,
  handler: withAuthHints(async args => {
    const api = await requireAuthAdmin(args)
    const user_id = await resolve_user_ref(api, args.user)
    const permissions = (await api.userPermissions(user_id)) as unknown as {
      value: string
      api_name: string
      api_identifier: string
      roles: { name: string }[]
    }[]
    if (args.json) return print_json(permissions)
    if (permissions.length === 0) {
      log.info(`📭 ${user_id} holds no permissions through roles.`)
      return
    }
    log.info(`🔑 ${user_id} holds ${permissions.length} permission(s):`)
    for (const p of permissions) {
      log.info(
        `  ${p.value}  — ${p.api_name} (${p.api_identifier}), via ${p.roles
          .map(r => r.name)
          .join(', ')}`
      )
    }
    log.info(
      '  A token carries the ones the client requests as scopes, for APIs with RBAC on.'
    )
  })
}
