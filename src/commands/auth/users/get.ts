import { CommandModule } from 'yargs'
import { requireAuthAdmin, withAuthHints } from '../../../api/auth_admin'
import { log } from '../../../log'
import { TenantArgs, json_option, tenant_options } from '../options'
import { print_json, when, yes_no } from '../render'

interface UsersGetArgs extends TenantArgs {
  user_id: string
}

export const users_get: CommandModule<unknown, UsersGetArgs> = {
  command: 'get <user_id>',
  describe: 'Show a user',
  builder: yargs =>
    json_option(tenant_options(yargs))
      .positional('user_id', {
        type: 'string',
        demandOption: true,
        description: 'User identifier (user_…)'
      })
      .showHelpOnFail(false) as any,
  handler: withAuthHints(async args => {
    const api = await requireAuthAdmin(args)
    const user = await api.userGet(args.user_id)

    if (args.json) return print_json(user)

    log.info(`👤 ${user.id}`)
    log.info(`  Email:      ${user.email ?? '-'} (verified: ${yes_no(user.email_verified)})`)
    log.info(`  Name:       ${user.name ?? '-'}`)
    if (user.phone) log.info(`  Phone:      ${user.phone}`)
    if (user.country_iso) log.info(`  Country:    ${user.country_iso}`)
    log.info(`  Created:    ${user.createdAt ?? '-'}`)
    log.info(
      `  Last login: ${user.last_login ? `${user.last_login} (${when(user.last_login)})` : '-'}${user.last_ip ? ` from ${user.last_ip}` : ''}`
    )
    log.info(`  Logins:     ${user.logins_count ?? 0}`)
    if (user.suspended) {
      log.info(`  Suspended:  🔴 yes (${user.suspended_at ?? 'unknown date'})`)
      if (user.suspended_reason) log.info(`  Reason:     ${user.suspended_reason}`)
    } else {
      log.info('  Suspended:  no')
    }
  })
}
