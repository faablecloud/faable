import { CommandModule } from 'yargs'
import { requireAuthAdmin, withAuthHints } from '../../../api/auth_admin'
import { log } from '../../../log'
import { TenantArgs, json_option, tenant_options } from '../options'
import { print_json } from '../render'
import {
  CLIENT_TYPES,
  ClientType,
  client_type_patch,
  is_public_client
} from './client_type'

interface ClientsCreateArgs extends TenantArgs {
  name: string
  description?: string
  callback?: string[]
  logoutUrl?: string[]
  webOrigin?: string[]
  type: ClientType
}

export const clients_create: CommandModule<unknown, ClientsCreateArgs> = {
  command: 'create',
  describe: 'Create an OAuth client',
  builder: yargs =>
    json_option(tenant_options(yargs))
      .option('name', {
        alias: 'n',
        type: 'string',
        demandOption: true,
        description: 'Client name'
      })
      .option('description', {
        alias: 'd',
        type: 'string',
        description: 'Client description'
      })
      .option('type', {
        alias: 't',
        choices: CLIENT_TYPES,
        default: 'web' as ClientType,
        description:
          'web: a server app that keeps a secret. spa / native: a browser or mobile app, a public client with PKCE and no secret'
      })
      .option('callback', {
        type: 'string',
        array: true,
        description: 'Allowed callback (redirect) URL — repeatable'
      })
      .option('logout-url', {
        type: 'string',
        array: true,
        description: 'Allowed post-logout URL — repeatable'
      })
      .option('web-origin', {
        type: 'string',
        array: true,
        description: 'Allowed web origin (CORS) — repeatable'
      })
      .example(
        '$0 auth clients create -n my-app --callback https://app.example.com/callback',
        'Create a client with one redirect URL'
      )
      .example(
        '$0 auth clients create -n my-spa -t spa --callback https://app.example.com/ --web-origin https://app.example.com',
        'Create a single-page app (public client, no secret)'
      )
      .showHelpOnFail(false) as any,
  handler: withAuthHints(async args => {
    const api = await requireAuthAdmin(args)
    const created = await api.clientCreate({
      name: args.name,
      ...(args.description ? { description: args.description } : {}),
      ...(args.callback?.length ? { callbacks: args.callback } : {}),
      ...(args.logoutUrl?.length ? { logout_urls: args.logoutUrl } : {}),
      ...(args.webOrigin?.length ? { web_origins: args.webOrigin } : {})
    })
    const patch = client_type_patch(args.type)
    const client = patch
      ? { ...created, ...(await api.clientUpdate(created.id, patch as any)) }
      : created
    const public_client = is_public_client(args.type)

    // A public client never uses its secret: printing one would only invite
    // someone to ship it in a bundle.
    if (args.json) {
      if (!public_client) return print_json(client)
      const { client_secret: _secret, ...rest } = client as any
      return print_json(rest)
    }

    log.info(`✅ Created client "${client.name}" (${client.id})`)
    log.info(`  Client ID:     ${client.client_id}`)
    if (public_client) {
      log.info(
        `  Type:          ${args.type} — public client: PKCE, no secret (safe to ship in the app)`
      )
      return
    }
    log.info(`  Client secret: ${client.client_secret}`)
    log.info('  ⚠️ Store the secret now — treat it like a password.')
  })
}
