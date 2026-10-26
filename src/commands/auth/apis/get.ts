import { CommandModule } from 'yargs'
import { requireAuthAdmin, withAuthHints } from '../../../api/auth_admin'
import { log } from '../../../log'
import { TenantArgs, json_option, tenant_options } from '../options'
import { print_json, yes_no } from '../render'
import { resolve_api_ref } from '../roles/shared'

interface ApisGetArgs extends TenantArgs {
  api: string
}

export const apis_get: CommandModule<unknown, ApisGetArgs> = {
  command: 'get <api>',
  describe: 'Show an API: token settings and its permission catalog',
  builder: yargs =>
    json_option(tenant_options(yargs))
      .positional('api', {
        type: 'string',
        demandOption: true,
        description: 'API id (api_…) or identifier (audience URL)'
      })
      .showHelpOnFail(false) as any,
  handler: withAuthHints(async args => {
    const admin = await requireAuthAdmin(args)
    const a = await resolve_api_ref(admin, args.api)
    if (args.json) return print_json(a)
    log.info(`🔌 ${a.name} (${a.id})`)
    log.info(`  Identifier:       ${a.identifier}`)
    log.info(`  Token dialect:    ${a.token_dialect ?? '-'}`)
    log.info(`  RBAC:             ${yes_no(a.rbac)}`)
    log.info(`  Enforce policies: ${yes_no(a.enforce_policies)}`)
    log.info(`  Permissions (${a.permissions?.length ?? 0}):`)
    for (const p of a.permissions ?? []) {
      log.info(`    ${p.value}${p.description ? `  — ${p.description}` : ''}`)
    }
    if (a.rbac && a.token_dialect !== 'access_token_authz') {
      log.warn(
        '⚠️  RBAC is on but the dialect is not access_token_authz: tokens carry no `permissions` claim.'
      )
    }
  })
}
