import { CommandModule } from 'yargs'
import { requireAuthAdmin, withAuthHints } from '../../../api/auth_admin'
import { confirm } from '../../../lib/interactive'
import { log } from '../../../log'
import { TenantArgs, json_option, tenant_options } from '../options'
import { print_json } from '../render'
import { find_connection } from './resolve'

interface ConnectionsRmArgs extends TenantArgs {
  connection: string
  yes?: boolean
}

export const connections_rm: CommandModule<unknown, ConnectionsRmArgs> = {
  command: 'rm <connection>',
  describe: 'Delete a login method',
  builder: yargs =>
    json_option(tenant_options(yargs))
      .positional('connection', {
        type: 'string',
        demandOption: true,
        description: 'Connection id (connection_…) or name'
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
    const found = await find_connection(api, args.connection)

    const go = await confirm({
      message: `Delete connection "${found.connection_name}" (${found.id})? Its users can no longer log in with it — \`disable\` is the reversible way.`,
      yes: args.yes
    })
    if (!go) {
      log.info('Cancelled.')
      return
    }

    await api.connectionDelete(found.id)
    if (args.json) {
      return print_json({
        deleted: true,
        id: found.id,
        connection_name: found.connection_name
      })
    }
    log.info(`🗑️ Deleted connection "${found.connection_name}" (${found.id}).`)
  })
}
