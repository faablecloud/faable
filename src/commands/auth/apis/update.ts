import { CommandModule } from 'yargs'
import { requireAuthAdmin, withAuthHints } from '../../../api/auth_admin'
import { CliError } from '../../../lib/errors'
import { log } from '../../../log'
import { TenantArgs, json_option, tenant_options } from '../options'
import { print_json, yes_no } from '../render'
import { resolve_api_ref } from '../roles/shared'

interface ApisUpdateArgs extends TenantArgs {
  api: string
  rbac?: boolean
  tokenDialect?: 'access_token' | 'access_token_authz'
  addPermission?: string[]
  rmPermission?: string[]
}

export const apis_update: CommandModule<unknown, ApisUpdateArgs> = {
  command: 'update <api>',
  describe: "Change an API's RBAC, token dialect and permission catalog",
  builder: yargs =>
    json_option(tenant_options(yargs))
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
      .showHelpOnFail(false) as any,
  handler: withAuthHints(async args => {
    const add = args.addPermission ?? []
    const rm = new Set(args.rmPermission ?? [])
    const patch: Record<string, unknown> = {
      ...(args.rbac !== undefined ? { rbac: args.rbac } : {}),
      ...(args.tokenDialect ? { token_dialect: args.tokenDialect } : {})
    }
    if (Object.keys(patch).length === 0 && !add.length && !rm.size) {
      throw new CliError(
        'usage',
        'Nothing to update — pass --rbac / --no-rbac, --token-dialect, --add-permission or --rm-permission.'
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
      `✅ ${a.name}: RBAC ${yes_no(a.rbac)}, dialect ${a.token_dialect}. Applies to tokens issued from now on.`
    )
    if (a.rbac && a.token_dialect !== 'access_token_authz') {
      log.warn(
        '⚠️  RBAC is on but the dialect is not access_token_authz: tokens carry no `permissions` claim.'
      )
    }
  })
}
