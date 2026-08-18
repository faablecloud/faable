import { Argv } from 'yargs'

// Flags shared by every `faable auth` subcommand. Defined per-leaf (not on the
// group) so yargs help shows them where they apply.
export interface TenantArgs {
  authUrl?: string
  account?: string
  json?: boolean
}

export const tenant_options = <T>(yargs: Argv<T>) =>
  yargs
    .option('auth-url', {
      type: 'string',
      description:
        'Auth tenant base URL, e.g. https://<account>.auth.faable.link (env FAABLE_AUTH_URL)'
    })
    .option('account', {
      type: 'string',
      description:
        'Resolve a different account id on the target host (env FAABLE_AUTH_ACCOUNT)'
    })

export const json_option = <T>(yargs: Argv<T>) =>
  yargs.option('json', {
    type: 'boolean',
    default: false,
    description: 'Output raw JSON (for scripting)'
  })

// Listing flags: one page of up to --limit items by default, --all walks the
// cursor to exhaustion (the API pages by `pageSize`≤200 + `next` cursor).
export interface ListArgs extends TenantArgs {
  limit: number
  all?: boolean
  query?: string
}

export const list_options = <T>(yargs: Argv<T>) =>
  yargs
    .option('limit', {
      type: 'number',
      default: 100,
      description: 'Max items to fetch in one page (1-200)'
    })
    .option('all', {
      type: 'boolean',
      default: false,
      description: 'Fetch every page (ignores --limit)'
    })
    .check(argv => {
      const limit = (argv as { limit?: number }).limit
      if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 200)) {
        throw new Error('--limit must be an integer between 1 and 200')
      }
      return true
    })
