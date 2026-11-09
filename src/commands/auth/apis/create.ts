import { CommandModule } from 'yargs'
import { requireAuthAdmin, withAuthHints } from '../../../api/auth_admin'
import { log } from '../../../log'
import { TenantArgs, json_option, tenant_options } from '../options'
import { print_json, yes_no } from '../render'
import {
  ApiSettingsArgs,
  api_setting_options,
  api_settings_patch
} from './settings'

type ApisCreateArgs = TenantArgs &
  ApiSettingsArgs & {
    identifier: string
    name?: string
    permission?: string[]
    rbac?: boolean
  }

export const apis_create: CommandModule<unknown, ApisCreateArgs> = {
  command: 'create <identifier>',
  describe: 'Create an API (the audience tokens are issued for)',
  builder: yargs =>
    api_setting_options(json_option(tenant_options(yargs)))
      .positional('identifier', {
        type: 'string',
        demandOption: true,
        description:
          'The audience URL clients request, e.g. https://api.example.com (cannot change later)'
      })
      .option('name', { type: 'string', description: 'Display name' })
      // No `-p`: it is the global --project.
      .option('permission', {
        type: 'string',
        array: true,
        description: 'A permission of its catalog — repeatable'
      })
      .option('rbac', {
        type: 'boolean',
        default: false,
        description:
          'Turn on RBAC (and the access_token_authz dialect, which carries `permissions`)'
      })
      .example(
        '$0 auth apis create https://api.example.com --permission tickets:read --permission tickets:write --rbac',
        'An API whose user tokens carry the permissions their roles grant'
      )
      .example(
        '$0 auth apis create https://api.example.com --token-lifetime 3600 --include-roles-in-access-token',
        'Access tokens that last one hour and carry the `roles` claim'
      )
      .showHelpOnFail(false) as any,
  handler: withAuthHints(async args => {
    // Before the login: a bad value fails without touching the network.
    const settings = api_settings_patch(args)
    const api = await requireAuthAdmin(args)
    const a = (await api.apiCreate({
      name: args.name ?? args.identifier,
      identifier: args.identifier,
      permissions: (args.permission ?? []).map(value => ({ value })),
      ...(args.rbac ? { rbac: true, token_dialect: 'access_token_authz' } : {}),
      ...settings
    } as any)) as any
    if (args.json) return print_json(a)
    log.info(
      `✅ Created API ${a.name} (${a.id}) — ${a.identifier}, ${a.permissions?.length ?? 0} permission(s), RBAC ${yes_no(a.rbac)}, tokens last ${a.token_lifetime} s.`
    )
  })
}
