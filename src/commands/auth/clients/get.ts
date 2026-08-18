import { CommandModule } from 'yargs'
import { requireAuthAdmin, withAuthHints } from '../../../api/auth_admin'
import { log } from '../../../log'
import { TenantArgs, json_option, tenant_options } from '../options'
import { print_json } from '../render'
import { resolve_client } from './resolve'

interface ClientsGetArgs extends TenantArgs {
  client_id: string
  secret?: boolean
}

export const clients_get: CommandModule<unknown, ClientsGetArgs> = {
  command: 'get <client_id>',
  describe: 'Show an OAuth client',
  builder: yargs =>
    json_option(tenant_options(yargs))
      .positional('client_id', {
        type: 'string',
        demandOption: true,
        description: 'Client resource id or OAuth client_id'
      })
      .option('secret', {
        type: 'boolean',
        default: false,
        description: 'Also print the client secret'
      })
      .showHelpOnFail(false) as any,
  handler: withAuthHints(async args => {
    const api = await requireAuthAdmin(args)
    const client = await resolve_client(api, args.client_id)

    if (args.json) return print_json(client)

    log.info(`🔑 ${client.name ?? client.id}`)
    log.info(`  ID:          ${client.id}`)
    log.info(`  Client ID:   ${client.client_id ?? '-'}`)
    if (args.secret) {
      log.info(`  Secret:      ${client.client_secret ?? '-'}`)
    }
    if (client.description) log.info(`  Description: ${client.description}`)
    log.info(`  Callbacks:   ${client.callbacks?.length ? client.callbacks.join(', ') : '-'}`)
    if (client.logout_urls?.length) {
      log.info(`  Logout URLs: ${client.logout_urls.join(', ')}`)
    }
    if (client.web_origins?.length) {
      log.info(`  Web origins: ${client.web_origins.join(', ')}`)
    }
    log.info(`  Created:     ${client.createdAt ?? '-'}`)
  })
}
