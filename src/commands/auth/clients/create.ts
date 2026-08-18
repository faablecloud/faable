import { CommandModule } from 'yargs'
import { requireAuthAdmin, withAuthHints } from '../../../api/auth_admin'
import { log } from '../../../log'
import { TenantArgs, json_option, tenant_options } from '../options'
import { print_json } from '../render'

interface ClientsCreateArgs extends TenantArgs {
  name: string
  description?: string
  callback?: string[]
  logoutUrl?: string[]
  webOrigin?: string[]
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
      .showHelpOnFail(false) as any,
  handler: withAuthHints(async args => {
    const api = await requireAuthAdmin(args)
    const client = await api.clientCreate({
      name: args.name,
      ...(args.description ? { description: args.description } : {}),
      ...(args.callback?.length ? { callbacks: args.callback } : {}),
      ...(args.logoutUrl?.length ? { logout_urls: args.logoutUrl } : {}),
      ...(args.webOrigin?.length ? { web_origins: args.webOrigin } : {})
    })

    if (args.json) return print_json(client)

    log.info(`✅ Created client "${client.name}" (${client.id})`)
    log.info(`  Client ID:     ${client.client_id}`)
    log.info(`  Client secret: ${client.client_secret}`)
    log.info('  ⚠️ Store the secret now — treat it like a password.')
  })
}
