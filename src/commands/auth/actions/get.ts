import { CommandModule } from 'yargs'
import { requireAuthAdmin, withAuthHints } from '../../../api/auth_admin'
import { log } from '../../../log'
import { TenantArgs, json_option, tenant_options } from '../options'
import { print_json, yes_no } from '../render'

interface ActionsGetArgs extends TenantArgs {
  action_id: string
  code?: boolean
}

export const actions_get: CommandModule<unknown, ActionsGetArgs> = {
  command: 'get <action_id>',
  describe: 'Show an action (use --code to print its source)',
  builder: yargs =>
    json_option(tenant_options(yargs))
      .positional('action_id', {
        type: 'string',
        demandOption: true,
        description: 'Action identifier'
      })
      .option('code', {
        type: 'boolean',
        default: false,
        description: 'Print the action source code'
      })
      .showHelpOnFail(false) as any,
  handler: withAuthHints(async args => {
    const api = await requireAuthAdmin(args)
    const action = await api.actionGet(args.action_id)

    if (args.json) return print_json(action)

    log.info(`⚙️ ${action.id}`)
    log.info(`  Name:    ${action.name ?? '-'}`)
    log.info(`  Triggers: ${formatTriggers(action as any)}`)
    log.info(`  Enabled: ${yes_no(action.enabled)}`)
    log.info(`  Order:   ${action.order ?? 0}`)
    log.info(`  Revision: ${(action as any).revision ?? 1} (updated ${action.updatedAt ?? '-'})`)
    log.info(`  Created: ${action.createdAt ?? '-'}`)
    if (args.code) {
      log.info('  Code:')
      // Raw to stdout so it can be piped to a file untouched.
      process.stdout.write((action.code ?? '') + '\n')
    }
  })
}
