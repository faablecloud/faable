import { closeSync, fchmodSync, openSync, writeSync } from 'node:fs'
import prompts from 'prompts'
import { CommandModule } from 'yargs'
import { requireAuthAdmin, withAuthHints } from '../../../api/auth_admin'
import { log } from '../../../log'
import { TenantArgs, tenant_options } from '../options'

// GET /user/export pages at most this many users.
const PAGE_SIZE = 500

interface ExportArgs extends TenantArgs {
  file?: string
  'include-hashes'?: boolean
  connection?: string
  force?: boolean
  yes?: boolean
}

export const users_export: CommandModule<unknown, ExportArgs> = {
  command: 'export [file]',
  describe:
    'Export every user as NDJSON, optionally with password hashes (the input of `faable auth users import --from faable`)',
  builder: yargs =>
    tenant_options(yargs)
      .positional('file', {
        type: 'string',
        description: 'Output file (created with mode 0600). Omit to write to stdout'
      })
      .option('include-hashes', {
        type: 'boolean',
        default: false,
        description:
          'Include password hashes. Needs the read:password_hashes permission, is audited and notifies the tenant credentials.exported subscribers'
      })
      .option('connection', {
        type: 'string',
        description:
          'Database connection (connection_name) whose hashes are exported. Defaults to the tenant database connection'
      })
      .option('force', {
        type: 'boolean',
        default: false,
        description: 'Allow writing password hashes to a terminal'
      })
      .option('yes', {
        alias: 'y',
        type: 'boolean',
        default: false,
        description: 'Skip the confirmation prompt'
      })
      .example('$0 auth users export users.ndjson', 'Export profiles and identities')
      .example(
        '$0 auth users export users.ndjson --include-hashes',
        'Export with password hashes (to move users to another tenant or provider)'
      )
      .showHelpOnFail(false) as any,
  handler: withAuthHints(async args => {
    const hashes = !!args['include-hashes']
    const to_stdout = !args.file

    // A hash dump scrolling past in a terminal ends up in scrollback, screen
    // recordings and shell logs.
    if (hashes && to_stdout && process.stdout.isTTY && !args.force) {
      throw new Error(
        'Refusing to print password hashes to a terminal: pass a file, pipe stdout, or add --force'
      )
    }

    if (hashes && !args.yes) {
      // The prompt goes to stderr so a piped stdout stays pure NDJSON.
      const { confirm } = await prompts(
        {
          type: 'toggle',
          name: 'confirm',
          message:
            'Export password hashes? Anyone holding the file can attack every password offline. The export is audited and notifies the tenant subscribers.',
          initial: false,
          active: 'yes',
          inactive: 'no',
          stdout: process.stderr
        },
        { onCancel: () => false }
      )
      if (!confirm) {
        process.stderr.write('Cancelled.\n')
        return
      }
    }

    const api = await requireAuthAdmin(args)
    // 0600: only the owner can read a file that holds password hashes. The
    // mode of `openSync` only applies when it creates the file, so an existing
    // one is tightened explicitly.
    const fd = to_stdout ? 1 : openSync(args.file!, 'w', 0o600)
    if (!to_stdout) fchmodSync(fd, 0o600)
    const counts = { users: 0, with_hash: 0, legacy: 0, not_set: 0, no_credential: 0 }
    try {
      let cursor: string | undefined
      do {
        const page = await api.userExport({
          cursor,
          limit: PAGE_SIZE,
          connection: args.connection,
          include_hashes: hashes
        })
        for (const row of page.users) {
          writeSync(fd, JSON.stringify(row) + '\n')
          counts.users += 1
          if (row.password_hash) counts.with_hash += 1
          if (row.password_hash_status === 'legacy_unexportable') counts.legacy += 1
          if (row.password_hash_status === 'not_set') counts.not_set += 1
          if (row.password_hash_status === 'no_credential') counts.no_credential += 1
        }
        cursor = page.next_cursor ?? undefined
        if (!to_stdout) log.info(`📤 ${counts.users} user(s)…`)
      } while (cursor)
    } finally {
      if (!to_stdout) closeSync(fd)
    }

    // The report goes to stderr: stdout may be the export itself.
    const report = [
      `Exported ${counts.users} user(s)${to_stdout ? '' : ` to ${args.file}`}.`,
      hashes ? `${counts.with_hash} with a password hash.` : 'No password hashes (add --include-hashes).',
      counts.legacy
        ? `${counts.legacy} still use a pre-2026 password format that is not exported: they need a password reset, or to sign in once before you export again.`
        : '',
      counts.not_set ? `${counts.not_set} never set a password.` : '',
      counts.no_credential ? `${counts.no_credential} have no password (social or passwordless only).` : ''
    ].filter(Boolean)
    process.stderr.write(report.join('\n') + '\n')
  })
}
