import { CommandModule } from 'yargs'
import { requireAuthAdmin, withAuthHints } from '../../../api/auth_admin'
import { log } from '../../../log'
import { TenantArgs, json_option, tenant_options } from '../options'
import { print_json } from '../render'
import { RoleRow, resolve_role_ref } from '../roles/shared'
import { resolve_user_ref } from './resolve'

interface UsersRolesArgs extends TenantArgs {
  user: string
  add?: string[]
  rm?: string[]
}

export const users_roles: CommandModule<unknown, UsersRolesArgs> = {
  command: 'roles <user>',
  describe: "List a user's roles, or assign / remove roles",
  builder: yargs =>
    json_option(tenant_options(yargs))
      .positional('user', {
        type: 'string',
        demandOption: true,
        description: 'User id (user_…) or exact email'
      })
      .option('add', {
        type: 'string',
        array: true,
        description: 'Role to assign (id or exact name) — repeatable'
      })
      .option('rm', {
        type: 'string',
        array: true,
        description: 'Role to remove (id or exact name) — repeatable'
      })
      .example(
        '$0 auth users roles ana@example.com --add support',
        'Assign a role: its permissions reach her next tokens'
      )
      .showHelpOnFail(false) as any,
  handler: withAuthHints(async args => {
    const api = await requireAuthAdmin(args)
    const user_id = await resolve_user_ref(api, args.user)
    const ids = async (refs: string[]) => {
      const out: string[] = []
      for (const r of refs) out.push((await resolve_role_ref(api, r)).id)
      return out
    }
    const add = await ids(args.add ?? [])
    const rm = await ids(args.rm ?? [])
    if (add.length) {
      await api.userAssignRoles(user_id, { roles: add } as any)
    }
    if (rm.length) {
      await api.userRemoveRoles(user_id, { roles: rm } as any)
    }
    const roles = (await api.userRoles(user_id)) as unknown as RoleRow[]
    if (args.json) return print_json(roles)
    if (add.length || rm.length) {
      log.info(
        `✅ Roles of ${user_id} updated. Their next tokens (refreshes included) reflect it.`
      )
    }
    if (roles.length === 0) {
      log.info(`📭 ${user_id} has no roles (team roles are on each team).`)
      return
    }
    log.info(`🎭 ${user_id} has ${roles.length} role(s):`)
    for (const r of roles) log.info(`  ${r.name}  (${r.id})`)
  })
}
