import { Argv } from 'yargs'
import { CliError } from '../../../lib/errors'

// The range the Auth API accepts (auth ApiCreate / ApiUpdate schemas).
export const TOKEN_LIFETIME_MIN = 60
export const TOKEN_LIFETIME_MAX = 60 * 60 * 24 * 30

// Every boolean setting `apis get --json` shows, flag = the field in kebab case.
export const API_BOOLEAN_SETTINGS = {
  allow_offline_access:
    'Clients may request `offline_access` and get a refresh_token for this API',
  skip_consent: 'Skip the consent screen for first-party clients',
  include_roles_in_access_token:
    "Access tokens carry a `roles` claim with the user's role names",
  include_teams_in_access_token:
    "Access tokens carry a `teams` claim with the user's team slugs",
  include_roles_in_id_token:
    'id_tokens issued with an access token for this API carry `roles`',
  include_teams_in_id_token:
    'id_tokens issued with an access token for this API carry `teams`',
  enforce_policies:
    'Filter the requested scopes against the permission catalog at issuance'
} as const

type BooleanSetting = keyof typeof API_BOOLEAN_SETTINGS

const camel = (field: string) =>
  field.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
const kebab = (field: string) => field.replace(/_/g, '-')

export type ApiSettingsArgs = {
  tokenLifetime?: string
  description?: string
} & { [K in BooleanSetting as string]?: unknown }

export const api_setting_options = <T>(yargs: Argv<T>) => {
  let y = yargs
    .option('token-lifetime', {
      // A string, so "3600.5" or "1h" are refused instead of rounded or NaN.
      type: 'string',
      description: `Access token lifetime in seconds, ${TOKEN_LIFETIME_MIN}–${TOKEN_LIFETIME_MAX} (30 days); a new API gets 86400`
    })
    .option('description', {
      type: 'string',
      description: 'Description of the API'
    }) as Argv<any>
  for (const [field, description] of Object.entries(API_BOOLEAN_SETTINGS)) {
    y = y.option(kebab(field), {
      type: 'boolean',
      description
    })
  }
  return y as Argv<T>
}

export const parse_token_lifetime = (raw: string): number => {
  const n = /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN
  if (
    !Number.isSafeInteger(n) ||
    n < TOKEN_LIFETIME_MIN ||
    n > TOKEN_LIFETIME_MAX
  ) {
    throw new CliError(
      'usage',
      `--token-lifetime must be a whole number of seconds between ${TOKEN_LIFETIME_MIN} and ${TOKEN_LIFETIME_MAX} (30 days), got "${raw}".`
    )
  }
  return n
}

// The fields of the body the flags ask for — only those passed.
export const api_settings_patch = (
  args: ApiSettingsArgs
): Record<string, unknown> => {
  const patch: Record<string, unknown> = {}
  if (args.tokenLifetime !== undefined) {
    patch.token_lifetime = parse_token_lifetime(String(args.tokenLifetime))
  }
  if (args.description !== undefined) patch.description = args.description
  for (const field of Object.keys(API_BOOLEAN_SETTINGS)) {
    const value = (args as any)[camel(field)]
    if (typeof value === 'boolean') patch[field] = value
  }
  return patch
}
