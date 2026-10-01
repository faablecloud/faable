import { Argv } from 'yargs'
import { ListArgs } from '../../lib/listing'

export { json_option, list_options } from '../../lib/listing'

// Flags shared by every `faable auth` subcommand. Defined per-leaf (not on the
// group) so yargs help shows them where they apply. Without either, the
// tenant is the active project's (see resolveTenant in src/api/auth_admin.ts).
export interface TenantArgs {
  authUrl?: string
  account?: string
  json?: boolean
}

export const tenant_options = <T>(yargs: Argv<T>) =>
  yargs
    .option('account', {
      type: 'string',
      description:
        "Auth tenant id (env FAABLE_AUTH_ACCOUNT). Default: the active project's tenant"
    })
    .option('auth-url', {
      type: 'string',
      description:
        'Auth tenant base URL, e.g. https://<slug>.auth.faable.link (env FAABLE_AUTH_URL)'
    })

export interface AuthListArgs extends ListArgs, TenantArgs {
  query?: string
}
