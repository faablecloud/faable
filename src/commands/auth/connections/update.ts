import { CommandModule } from 'yargs'
import { requireAuthAdmin, withAuthHints } from '../../../api/auth_admin'
import { CliError } from '../../../lib/errors'
import { log } from '../../../log'
import { TenantArgs, json_option, tenant_options } from '../options'
import { print_json } from '../render'
import { public_connection } from './body'
import { find_connection } from './resolve'

interface ConnectionsUpdateArgs extends TenantArgs {
  connection: string
  enabled?: boolean
  name?: string
}

const connection_positional = <T>(yargs: any) =>
  json_option(tenant_options(yargs)).positional('connection', {
    type: 'string',
    demandOption: true,
    description: 'Connection id (connection_…) or name'
  }) as T

const apply = async (
  args: TenantArgs & { connection: string },
  patch: { enabled?: boolean; connection_name?: string }
) => {
  const api = await requireAuthAdmin(args)
  const found = await find_connection(api, args.connection)
  const updated = public_connection(
    await api.connectionUpdate(found.id, patch as any)
  )
  if (args.json) return print_json(updated)
  log.info(
    `✅ Updated connection "${updated.connection_name}" (${updated.id}) — ${updated.enabled ? 'enabled' : 'disabled'}`
  )
}

// Off is reversible: the connection, its settings and every identity linked to
// it stay; its users just cannot log in with it until it is on again.
export const connections_update: CommandModule<unknown, ConnectionsUpdateArgs> =
  {
    command: 'update <connection>',
    describe: 'Turn a login method on or off, or rename it',
    builder: yargs =>
      connection_positional<any>(yargs)
        .option('enabled', {
          type: 'boolean',
          description:
            'On, or with --no-enabled off (its users cannot log in with it until it is on again)'
        })
        .option('name', {
          alias: 'n',
          type: 'string',
          description: 'New connection name'
        })
        .example(
          '$0 auth connections update google --no-enabled',
          'Stop Google logins on every client, keeping the connection'
        )
        .showHelpOnFail(false),
    handler: withAuthHints(async args => {
      const patch = {
        ...(args.enabled !== undefined ? { enabled: args.enabled } : {}),
        ...(args.name !== undefined ? { connection_name: args.name } : {})
      }
      if (Object.keys(patch).length === 0) {
        throw new CliError(
          'usage',
          'Nothing to update — pass --enabled, --no-enabled or --name'
        )
      }
      return apply(args, patch)
    })
  }

const toggle = (
  enabled: boolean
): CommandModule<unknown, TenantArgs & { connection: string }> => ({
  command: `${enabled ? 'enable' : 'disable'} <connection>`,
  describe: enabled
    ? 'Turn a login method on'
    : 'Turn a login method off (its users cannot log in with it until it is on again)',
  builder: yargs => connection_positional<any>(yargs).showHelpOnFail(false),
  handler: withAuthHints(async args => apply(args, { enabled }))
})

export const connections_enable = toggle(true)
export const connections_disable = toggle(false)
