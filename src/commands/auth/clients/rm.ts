import { CommandModule } from 'yargs'
import { requireAuthAdmin, withAuthHints } from '../../../api/auth_admin'
import { log } from '../../../log'
import { TenantArgs, tenant_options } from '../options'
import { resolve_client } from './resolve'
import { confirm } from '../../../lib/interactive'

interface ClientsRmArgs extends TenantArgs {
  client_id: string
  yes?: boolean
}

export const clients_rm: CommandModule<unknown, ClientsRmArgs> = {
  command: 'rm <client_id>',
  describe: 'Delete an OAuth client',
  builder: yargs =>
    tenant_options(yargs)
      .positional('client_id', {
        type: 'string',
        demandOption: true,
        description: 'Client resource id or OAuth client_id'
      })
      .option('yes', {
        alias: 'y',
        type: 'boolean',
        default: false,
        description: 'Skip the confirmation prompt'
      })
      .showHelpOnFail(false) as any,
  handler: withAuthHints(async args => {
    const api = await requireAuthAdmin(args)
    const client = await resolve_client(api, args.client_id)

    const go = await confirm({
      message:
        `Delete client "${client.name}" (${client.client_id})? Apps using it will stop authenticating.`,
      yes: args.yes
    })
    if (!go) {
      log.info('Cancelled.')
      return
    }

    await api.clientDelete(client.id)
    log.info(`🗑️ Deleted client ${client.client_id} (${client.id}).`)
  })
}
