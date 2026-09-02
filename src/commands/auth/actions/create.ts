import fs from 'fs-extra'
import { CommandModule } from 'yargs'
import { requireAuthAdmin, withAuthHints } from '../../../api/auth_admin'
import { log } from '../../../log'
import { TenantArgs, json_option, tenant_options } from '../options'
import { print_json } from '../render'
import { formatTriggers } from './triggers'

interface ActionsCreateArgs extends TenantArgs {
  name: string
  codeFile: string
  disabled?: boolean
  order?: number
}

export const actions_create: CommandModule<unknown, ActionsCreateArgs> = {
  command: 'create',
  describe: 'Create an action',
  builder: yargs =>
    json_option(tenant_options(yargs))
      .option('name', {
        alias: 'n',
        type: 'string',
        demandOption: true,
        description: 'Action name (max 200 chars)'
      })
      .option('code-file', {
        alias: 'f',
        type: 'string',
        demandOption: true,
        description:
          'Path to a JS file with the action code. The triggers are derived from the hooks it exports (exports.onExecutePostLogin / onExecuteContinue / onExecuteClientCredentials)'
      })
      .option('disabled', {
        type: 'boolean',
        default: false,
        description: 'Create the action disabled'
      })
      .option('order', {
        type: 'number',
        description: 'Execution order (lower runs first, default 0)'
      })
      .example(
        '$0 auth actions create -n add-claims -f ./claims.js',
        'Create an action from a file; its triggers follow the exported hooks'
      )
      .showHelpOnFail(false) as any,
  handler: withAuthHints(async args => {
    if (!(await fs.pathExists(args.codeFile))) {
      throw new Error(`Code file not found: ${args.codeFile}`)
    }
    const code = await fs.readFile(args.codeFile, 'utf8')

    const api = await requireAuthAdmin(args)
    const action = await api.actionCreate({
      name: args.name,
      code,
      ...(args.disabled ? { enabled: false } : {}),
      ...(args.order !== undefined ? { order: args.order } : {})
      // `trigger` is gone from the API (auth ≥ v1.58): triggers are derived
      // from the code. Cast until the SDK types catch up with that release.
    } as any)

    if (args.json) return print_json(action)
    log.info(
      `✅ Created action ${action.id} (${action.name}, triggers ${formatTriggers(action)})`
    )
  })
}
