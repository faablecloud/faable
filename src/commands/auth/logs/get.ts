import { CommandModule } from 'yargs'
import { requireAuthAdmin, withAuthHints } from '../../../api/auth_admin'
import { log } from '../../../log'
import { TenantArgs, json_option, tenant_options } from '../options'
import { log_status_badge, print_json } from '../render'

interface LogsGetArgs extends TenantArgs {
  log_id: string
}

export const logs_get: CommandModule<unknown, LogsGetArgs> = {
  command: 'get <log_id>',
  describe: 'Show an audit log entry',
  builder: yargs =>
    json_option(tenant_options(yargs))
      .positional('log_id', {
        type: 'string',
        demandOption: true,
        description: 'Log entry identifier'
      })
      .showHelpOnFail(false) as any,
  handler: withAuthHints(async args => {
    const api = await requireAuthAdmin(args)
    const entry = await api.logGet(args.log_id)

    if (args.json) return print_json(entry)

    log.info(`📜 ${entry.id}`)
    log.info(`  Date:    ${entry.createdAt ?? '-'}`)
    log.info(`  Type:    ${entry.type ?? '-'}`)
    log.info(`  Status:  ${log_status_badge(entry.status)}`)
    if (entry.message) log.info(`  Message: ${entry.message}`)
    const refs: Array<[string, unknown]> = [
      ['User', entry.user],
      ['Client', entry.client],
      ['Connection', entry.connection],
      ['Team', entry.team],
      ['Identity', entry.identity]
    ]
    for (const [label, ref] of refs) {
      if (!ref) continue
      const id = typeof ref === 'string' ? ref : (ref as { id?: string }).id
      if (id) log.info(`  ${label}:${' '.repeat(Math.max(1, 8 - label.length))}${id}`)
    }
    if (entry.data !== undefined && entry.data !== null) {
      log.info('  Data:')
      process.stdout.write(JSON.stringify(entry.data, null, 2) + '\n')
    }
  })
}
