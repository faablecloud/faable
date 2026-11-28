import { CliError } from '../../../lib/errors'

// The connection types the Auth API accepts (auth: schemas/ConnectionType.ts).
// The strings are permanent there: persisted on every connection and published
// in the OpenAPI enum.
export const CONNECTION_TYPES = [
  'passwordless_email',
  'database',
  'google_oauth2',
  'github',
  'microsoft',
  'apple',
  'facebook',
  'linkedin',
  'discord',
  'gitlab',
  'slack',
  'x',
  'twitch',
  'bitbucket',
  'spotify',
  'figma',
  'oidc',
  'custom'
] as const
export type ConnectionTypeName = (typeof CONNECTION_TYPES)[number]

// Email codes and username/password keep their users in the tenant: there is
// no provider to hand a client id or a secret to.
const LOCAL_TYPES: ConnectionTypeName[] = ['passwordless_email', 'database']

export interface ConnectionCreateInput {
  name: string
  type: ConnectionTypeName
  enabled?: boolean
  clientId?: string
  clientSecret?: string
  issuer?: string
  authorizeUrl?: string
  tokenUrl?: string
  userinfoUrl?: string
  jwksUrl?: string
  scope?: string[]
  organization?: string
  disableSignup?: boolean
  appleTeamId?: string
  appleKeyId?: string
}

const PROVIDER_FIELDS: [keyof ConnectionCreateInput, string, string][] = [
  ['clientId', '--client-id', 'client_id'],
  ['clientSecret', '--client-secret-file', 'client_secret'],
  ['issuer', '--issuer', 'issuer'],
  ['authorizeUrl', '--authorize-url', 'authorize_url'],
  ['tokenUrl', '--token-url', 'token_url'],
  ['userinfoUrl', '--userinfo-url', 'userinfo_url'],
  ['jwksUrl', '--jwks-url', 'jwks_url'],
  ['organization', '--organization', 'organization']
]

/**
 * The POST /connection body. Only what was given travels: a social provider
 * left without --client-id keeps Faable's shared app where there is one, and
 * the server decides what a type requires (it is the source of truth).
 */
export const connection_create_body = (
  input: ConnectionCreateInput
): Record<string, unknown> => {
  if (LOCAL_TYPES.includes(input.type)) {
    const given = PROVIDER_FIELDS.filter(([k]) => input[k] !== undefined)
    if (given.length || input.scope?.length) {
      const flags = [
        ...given.map(([, flag]) => flag),
        ...(input.scope?.length ? ['--scope'] : [])
      ]
      throw new CliError(
        'usage',
        `${input.type} has no identity provider: ${flags.join(', ')} only apply to social and OIDC connections.`
      )
    }
  }
  const body: Record<string, unknown> = {
    connection_name: input.name,
    connection_type: input.type,
    enabled: input.enabled ?? true
  }
  for (const [k, , field] of PROVIDER_FIELDS) {
    if (input[k] !== undefined && input[k] !== '') body[field] = input[k]
  }
  if (input.scope?.length) body.scope = input.scope
  // Apple's client secret is a JWT Faable signs with the .p8 key; the
  // signature needs these two identifiers.
  if (input.appleTeamId || input.appleKeyId) {
    if (input.type !== 'apple') {
      throw new CliError(
        'usage',
        '--apple-team-id and --apple-key-id only apply to apple connections.'
      )
    }
    body.provider_options = {
      ...(input.appleTeamId ? { team_id: input.appleTeamId } : {}),
      ...(input.appleKeyId ? { key_id: input.appleKeyId } : {})
    }
  }
  if (input.disableSignup !== undefined)
    body.disable_signup = input.disableSignup
  return body
}

/**
 * What the CLI shows of a connection: never its client secret (Apple's is a
 * private key), not even with --json, where it would end up in a script's log.
 */
export const public_connection = (c: any) => {
  if (!c || typeof c !== 'object') return c
  const { client_secret, ...rest } = c
  return client_secret ? { ...rest, client_secret: '[hidden]' } : rest
}

// A secret from a file, or from stdin with `-`: never from argv, where `ps`
// and the shell history read it. Surrounding whitespace goes (a trailing
// newline from `echo` or an editor is never part of a secret); a PEM key keeps
// its inner lines.
export const clean_secret = (raw: string, source: string): string => {
  const secret = raw.trim()
  if (!secret)
    throw new CliError('usage', `The client secret from ${source} is empty.`)
  return secret
}
