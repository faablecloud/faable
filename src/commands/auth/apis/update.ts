import { CommandModule } from 'yargs'
import { requireAuthAdmin, withAuthHints } from '../../../api/auth_admin'
import { CliError } from '../../../lib/errors'
import { log } from '../../../log'
import { TenantArgs, json_option, tenant_options } from '../options'
import { print_json, yes_no } from '../render'
import { resolve_api_ref } from '../roles/shared'
import {
  ApiSettingsArgs,
  api_setting_options,
  api_settings_patch
} from './settings'

type ApisUpdateArgs = TenantArgs &
  ApiSettingsArgs & {
    api: string
    rbac?: boolean
    tokenDialect?: 'access_token' | 'access_token_authz'
    addPermission?: string[]
    rmPermission?: string[]
  }

export const apis_update: CommandModule<unknown, ApisUpdateArgs> = {
  command: 'update <api>',
  describe:
    "Change an API's token settings and permission catalog (its identifier cannot change)",
  builder: yargs =>
    api_setting_options(json_option(tenant_options(yargs)))
      .positional('api', {
        type: 'string',
        demandOption: true,
        description: 'API id (api_…) or identifier (audience URL)'
      })
      .option('rbac', {
        type: 'boolean',
        description:
          'User tokens carry only the requested permissions their roles grant (--rbac), or as before (--no-rbac)'
      })
      .option('token-dialect', {
        type: 'string',
        choices: ['access_token', 'access_token_authz'] as const,
        description:
          'access_token_authz adds the `permissions` claim (needed for RBAC)'
      })
      .option('add-permission', {
        type: 'string',
        array: true,
        description: 'Add a permission to the catalog — repeatable'
      })
      .option('rm-permission', {
        type: 'string',
        array: true,
        description:
          'Remove a permission from the catalog — repeatable. Roles that grant it stop granting it'
      })
      .example(
        '$0 auth apis update https://api.example.com --rbac --token-dialect access_token_authz',
        'Turn on RBAC for an API'
      )
      .example(
        '$0 auth apis update https://api.example.com --token-lifetime 3600',
        'Access tokens issued from now on last one hour'
      )
      .epilog(
        'Turn a yes/no setting off with --no-<flag>, e.g. --no-skip-consent. Changes apply to tokens issued from now on; tokens already issued keep theirs until they expire. The identifier (audience) cannot be changed: create a new API.'
      )
      .showHelpOnFail(false) as any,
  handler: withAuthHints(async args => {
    const add = args.addPermission ?? []
    const rm = new Set(args.rmPermission ?? [])
    const patch: Record<string, unknown> = {
      ...(args.rbac !== undefined ? { rbac: args.rbac } : {}),
      ...(args.tokenDialect ? { token_dialect: args.tokenDialect } : {}),
      ...api_settings_patch(args)
    }
    if (Object.keys(patch).length === 0 && !add.length && !rm.size) {
      throw new CliError(
        'usage',
        'Nothing to update — pass a setting (--token-lifetime, --rbac, --token-dialect, --include-roles-in-access-token…), --add-permission or --rm-permission. See --help.'
      )
    }
    const admin = await requireAuthAdmin(args)
    const target = await resolve_api_ref(admin, args.api)
    if (add.length || rm.size) {
      // The API replaces the whole catalog: rebuild it from the current one.
      const current = (target.permissions ?? []).filter(p => !rm.has(p.value))
      const known = new Set(current.map(p => p.value))
      patch.permissions = [
        ...current,
        ...add.filter(v => !known.has(v)).map(value => ({ value }))
      ]
    }
    const a = (await admin.apiUpdate(target.id, patch as any)) as any
    if (args.json) return print_json(a)
    log.info(
      `✅ ${a.name}: RBAC ${yes_no(a.rbac)}, dialect ${a.token_dialect}, tokens last ${a.token_lifetime} s. Applies to tokens issued from now on.`
    )
    if (a.rbac && a.token_dialect !== 'access_token_authz') {
      log.warn(
        '⚠️  RBAC is on but the dialect is not access_token_authz: tokens carry no `permissions` claim.'
      )
    }
  })
}
