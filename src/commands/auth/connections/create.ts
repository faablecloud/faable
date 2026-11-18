import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { CommandModule } from 'yargs'
import { requireAuthAdmin, withAuthHints } from '../../../api/auth_admin'
import { CliError } from '../../../lib/errors'
import { read_stdin } from '../../../lib/stdin'
import { log } from '../../../log'
import { TenantArgs, json_option, tenant_options } from '../options'
import { print_json } from '../render'
import {
  CONNECTION_TYPES,
  ConnectionTypeName,
  clean_secret,
  connection_create_body,
  public_connection
} from './body'

interface ConnectionsCreateArgs extends TenantArgs {
  name: string
  type: ConnectionTypeName
  enabled?: boolean
  clientId?: string
  clientSecretFile?: string
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

const STDIN = '-'

const read_secret = async (path: string): Promise<string> => {
  if (path === STDIN) return clean_secret(await read_stdin(), 'stdin')
  try {
    return clean_secret(readFileSync(resolve(path), 'utf8'), path)
  } catch (err) {
    if ((err as { code?: string }).code === 'ENOENT') {
      throw new CliError('usage', `No such file: ${path}`, { cause: err })
    }
    throw err
  }
}

// A tenant is born with no connections, and a client with no connection fails
// at /authorize with "has no login method available". This is the first step
// after `faable auth clients create` on a new tenant.
export const connections_create: CommandModule<unknown, ConnectionsCreateArgs> =
  {
    command: 'create',
    describe: 'Create a login method (email code, password, social, OIDC)',
    builder: yargs =>
      json_option(tenant_options(yargs))
        .option('name', {
          alias: 'n',
          type: 'string',
          demandOption: true,
          description: 'Connection name, e.g. email or google'
        })
        .option('type', {
          alias: 't',
          choices: CONNECTION_TYPES,
          demandOption: true,
          description:
            'passwordless_email: a code by email. database: username and password. The rest: a social provider, or oidc for any OpenID Connect identity provider'
        })
        .option('enabled', {
          type: 'boolean',
          default: true,
          description: 'Create it on (default) or, with --no-enabled, off'
        })
        .option('client-id', {
          type: 'string',
          description:
            "Your OAuth app's client id at the provider. Google, GitHub and Microsoft work without one (Faable's shared app)"
        })
        .option('client-secret-file', {
          type: 'string',
          // Without it yargs reads a lone `-` as a command, not as the value.
          requiresArg: true,
          description:
            "File with your OAuth app's client secret (Apple: the .p8 key); `-` reads it from stdin. Never on the command line"
        })
        .option('issuer', {
          type: 'string',
          description:
            'OIDC issuer URL; its discovery document gives the endpoints'
        })
        .option('authorize-url', {
          type: 'string',
          description: 'Authorization endpoint'
        })
        .option('token-url', { type: 'string', description: 'Token endpoint' })
        .option('userinfo-url', {
          type: 'string',
          description: 'Userinfo endpoint'
        })
        .option('jwks-url', {
          type: 'string',
          description: 'JWKS endpoint (oidc)'
        })
        .option('scope', {
          type: 'string',
          array: true,
          description:
            "OAuth scopes to request — repeatable. Default: the provider's"
        })
        .option('organization', {
          type: 'string',
          description:
            'Organization (organization_…) whose identity provider this is. Only oidc, Pro plan'
        })
        .option('apple-team-id', {
          type: 'string',
          description: 'Apple: your Apple Developer Team ID'
        })
        .option('apple-key-id', {
          type: 'string',
          description:
            'Apple: the Key ID of the .p8 key passed with --client-secret-file'
        })
        .option('disable-signup', {
          type: 'boolean',
          description: 'Only existing users may log in with it; no new sign-ups'
        })
        .example(
          '$0 auth connections create -n email -t passwordless_email',
          'Let users log in with a code sent by email'
        )
        .example(
          '$0 auth connections create -n google -t google_oauth2',
          "Log in with Google, on Faable's shared Google app"
        )
        .example(
          'printf %s "$SECRET" | $0 auth connections create -n okta -t oidc --issuer https://acme.okta.com --client-id 0oa1… --client-secret-file -',
          'An OIDC identity provider, the secret read from stdin'
        )
        .showHelpOnFail(false) as any,
    handler: withAuthHints(async args => {
      // Everything is checked and read before any request: a bad flag or an
      // empty secret costs nothing.
      const clientSecret = args.clientSecretFile
        ? await read_secret(args.clientSecretFile)
        : undefined
      const body = connection_create_body({
        name: args.name,
        type: args.type,
        enabled: args.enabled,
        clientId: args.clientId,
        clientSecret,
        issuer: args.issuer,
        authorizeUrl: args.authorizeUrl,
        tokenUrl: args.tokenUrl,
        userinfoUrl: args.userinfoUrl,
        jwksUrl: args.jwksUrl,
        scope: args.scope,
        organization: args.organization,
        disableSignup: args.disableSignup,
        appleTeamId: args.appleTeamId,
        appleKeyId: args.appleKeyId
      })

      const api = await requireAuthAdmin(args)
      const created = public_connection(await api.connectionCreate(body as any))
      if (args.json) return print_json(created)

      log.info(
        `✅ Created connection "${created.connection_name}" (${created.id}) — ${created.connection_type}, ${created.enabled ? 'enabled' : 'disabled'}`
      )
      if (!created.enabled) {
        log.info(
          `  Turn it on with: faable auth connections enable ${created.id}`
        )
        return
      }
      // A client's login methods are a deny list: a new connection is on
      // every client that has not removed it.
      log.info(
        `  Every client of the tenant offers it. To keep it off one: faable auth clients update <client> --disable-connection ${created.id}`
      )
    })
  }
