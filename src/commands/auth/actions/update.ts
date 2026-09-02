import fs from 'fs-extra'
import { CommandModule } from 'yargs'
import { requireAuthAdmin, withAuthHints } from '../../../api/auth_admin'
import { log } from '../../../log'
import { TenantArgs, json_option, tenant_options } from '../options'
import { print_json } from '../render'
import { formatTriggers } from './triggers'

interface ActionsUpdateArgs extends TenantArgs {
  action_id: string
  name?: string
  codeFile?: string
  order?: number
  enabled?: boolean
}

export const actions_update: CommandModule<unknown, ActionsUpdateArgs> = {
  command: 'update <action_id>',
  describe: 'Update an action (code, name, order, enabled)',
  builder: yargs =>
    json_option(tenant_options(yargs))
      .positional('action_id', {
        type: 'string',
        demandOption: true,
        description: 'Action identifier'
      })
      .option('name', {
        alias: 'n',
        type: 'string',
        description: 'New action name (max 200 chars)'
      })
      .option('code-file', {
        alias: 'f',
        type: 'string',
        description:
          'Path to a JS file with the new action code (triggers are re-derived from the hooks it exports)'
      })
      .option('order', {
        type: 'number',
        description: 'Execution order (lower runs first)'
      })
      .option('enabled', {
        type: 'boolean',
        description: 'Enable (--enabled) or disable (--no-enabled) the action'
      })
      .example(
        '$0 auth actions update action_abc123 -f ./gate.js',
        "Replace an action's code from a file"
      )
      .example(
        '$0 auth actions update action_abc123 --no-enabled',
        'Disable an action without touching its code'
      )
      .showHelpOnFail(false) as any,
  handler: withAuthHints(async args => {
    let code: string | undefined
    if (args.codeFile) {
      if (!(await fs.pathExists(args.codeFile))) {
        throw new Error(`Code file not found: ${args.codeFile}`)
      }
      code = await fs.readFile(args.codeFile, 'utf8')
    }

    const patch = {
      ...(args.name !== undefined ? { name: args.name } : {}),
      ...(code !== undefined ? { code } : {}),
      ...(args.order !== undefined ? { order: args.order } : {}),
      ...(args.enabled !== undefined ? { enabled: args.enabled } : {})
    }
    if (Object.keys(patch).length === 0) {
      throw new Error(
        'Nothing to update — pass at least one of --name, --code-file, --order, --enabled'
      )
    }

    const api = await requireAuthAdmin(args)
    const action = await api.actionUpdate(args.action_id, patch)

    if (args.json) return print_json(action)
    log.info(
      `✅ Updated action ${action.id} (${action.name}, triggers ${formatTriggers(action as any)}, enabled: ${action.enabled ? '✓' : '✗'}, revision ${(action as any).revision ?? '-'})`
    )
  })
}
