import fs from 'fs-extra'
import { CommandModule } from 'yargs'
import { requireAuthAdmin, withAuthHints } from '../../../api/auth_admin'
import { log } from '../../../log'
import { TenantArgs, json_option, tenant_options } from '../options'
import { print_json } from '../render'

interface ActionsCreateArgs extends TenantArgs {
  name: string
  trigger: string
  codeFile?: string
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
      .option('trigger', {
        alias: 't',
        type: 'string',
        choices: ['post-login', 'continue', 'client-credentials'],
        demandOption: true,
        description:
          'Trigger point (client-credentials runs on M2M token grants: no user, no redirect)'
      })
      .option('code-file', {
        alias: 'f',
        type: 'string',
        description: 'Path to a JS file with the action code'
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
        '$0 auth actions create -n add-claims -t post-login -f ./claims.js',
        'Create a post-login action from a file'
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

    const api = await requireAuthAdmin(args)
    const action = await api.actionCreate({
      name: args.name,
      trigger: args.trigger,
      ...(code !== undefined ? { code } : {}),
      ...(args.disabled ? { enabled: false } : {}),
      ...(args.order !== undefined ? { order: args.order } : {})
    })

    if (args.json) return print_json(action)
    log.info(`✅ Created action ${action.id} (${action.name}, trigger ${action.trigger})`)
  })
}
