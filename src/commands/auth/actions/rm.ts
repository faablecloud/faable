import prompts from 'prompts'
import { CommandModule } from 'yargs'
import { requireAuthAdmin, withAuthHints } from '../../../api/auth_admin'
import { log } from '../../../log'
import { formatTriggers } from './triggers'
import { TenantArgs, tenant_options } from '../options'

interface ActionsRmArgs extends TenantArgs {
  action_id: string
  yes?: boolean
}

export const actions_rm: CommandModule<unknown, ActionsRmArgs> = {
  command: 'rm <action_id>',
  describe: 'Delete an action',
  builder: yargs =>
    tenant_options(yargs)
      .positional('action_id', {
        type: 'string',
        demandOption: true,
        description: 'Action identifier'
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
    // Fetch first: shows WHAT will be deleted and 404s before the prompt.
    const action = await api.actionGet(args.action_id)

    if (!args.yes) {
      const { confirm } = await prompts({
        type: 'toggle',
        name: 'confirm',
        message: `Delete action "${action.name}" (${action.id}, triggers ${formatTriggers(action as any)})?`,
        initial: false,
        active: 'yes',
        inactive: 'no'
      })
      if (!confirm) {
        log.info('Cancelled.')
        return
      }
    }

    await api.actionDelete(args.action_id)
    log.info(`🗑️ Deleted action ${args.action_id}.`)
  })
}
