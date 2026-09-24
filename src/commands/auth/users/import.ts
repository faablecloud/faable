import { readFile } from 'node:fs/promises'
import prompts from 'prompts'
import { CommandModule } from 'yargs'
import { requireAuthAdmin, withAuthHints } from '../../../api/auth_admin'
import { log } from '../../../log'
import { TenantArgs, json_option, tenant_options } from '../options'
import { print_json } from '../render'
import {
  ADAPTERS,
  AdapterOptions,
  ImportRow,
  SOURCES,
  SOURCE_FORMAT,
  Source
} from './import/adapters'
import { parse_records } from './import/records'

// The server takes at most this many rows per request (POST /user/import).
export const BATCH_SIZE = 500

interface ImportArgs extends TenantArgs {
  file: string
  from: Source
  format?: 'json' | 'csv'
  connection?: string
  'map-connection'?: string[]
  'update-existing'?: boolean
  'dry-run'?: boolean
  'hash-key'?: string
  'salt-separator'?: string
  rounds?: number
  'mem-cost'?: number
  yes?: boolean
}

export type RowResult = {
  // 1-based position of the record in the file.
  record: number
  email?: string
  status: 'created' | 'updated' | 'skipped' | 'error'
  user_id?: string
  error?: { code: string; message: string }
}

const parse_connection_map = (pairs: string[] = []): Record<string, string> =>
  Object.fromEntries(
    pairs.map(pair => {
      const [from, to] = pair.split('=')
      if (!from || !to) {
        throw new Error(`--map-connection expects provider=connection, got "${pair}"`)
      }
      return [from, to]
    })
  )

const firebase_config = (args: ImportArgs): AdapterOptions['firebase'] => {
  const given = [args['hash-key'], args['salt-separator'], args.rounds, args['mem-cost']]
  if (given.every(v => v === undefined)) return undefined
  if (given.some(v => v === undefined)) {
    throw new Error('--hash-key, --salt-separator, --rounds and --mem-cost go together')
  }
  return {
    signer_key: args['hash-key']!,
    salt_separator: args['salt-separator']!,
    rounds: args.rounds!,
    mem_cost: args['mem-cost']!
  }
}

// Reads and adapts the whole file before anything is sent: a malformed file
// fails here, not after half of it went in.
export const prepare_rows = (
  text: string,
  source: Source,
  opts: AdapterOptions & { format?: 'json' | 'csv' }
) => {
  const records = parse_records(text, opts.format ?? SOURCE_FORMAT[source])
  const rows: Array<{ record: number; row: ImportRow }> = []
  const skipped: RowResult[] = []
  records.forEach((raw, i) => {
    const adapted = ADAPTERS[source](raw, opts)
    if ('skip' in adapted) {
      skipped.push({
        record: i + 1,
        status: 'error',
        error: { code: 'unusable_record', message: adapted.skip }
      })
    } else {
      rows.push({ record: i + 1, row: adapted.row })
    }
  })
  return { total: records.length, rows, skipped }
}

export const users_import: CommandModule<unknown, ImportArgs> = {
  command: 'import <file>',
  describe:
    'Import users from another provider, with their password hashes (bcrypt, scrypt, Firebase scrypt, PBKDF2, argon2)',
  builder: yargs =>
    json_option(tenant_options(yargs))
      .positional('file', {
        type: 'string',
        demandOption: true,
        description: 'The export file of the provider you are leaving'
      })
      .option('from', {
        choices: SOURCES,
        demandOption: true,
        description:
          'Where the file comes from: auth0 (NDJSON with passwordHash), clerk (CSV), firebase (auth:export JSON), supabase (auth.users dump), keycloak (realm export), faable (faable auth users export)'
      })
      .option('format', {
        choices: ['json', 'csv'] as const,
        description: 'Override the file format guessed from --from'
      })
      .option('connection', {
        type: 'string',
        description:
          'Database connection (connection_name) the passwords go to. Defaults to the tenant database connection'
      })
      .option('map-connection', {
        type: 'string',
        array: true,
        description:
          'Rename a social provider to your connection_name, e.g. google-oauth2=google (repeatable)'
      })
      .option('update-existing', {
        type: 'boolean',
        default: false,
        description:
          'Set the password hash of users that already exist (same email) instead of skipping them'
      })
      .option('dry-run', {
        type: 'boolean',
        default: false,
        description: 'Validate every row on the server without writing anything'
      })
      .option('hash-key', {
        type: 'string',
        description: 'Firebase: base64_signer_key from the password hash parameters'
      })
      .option('salt-separator', {
        type: 'string',
        description: 'Firebase: base64_salt_separator'
      })
      .option('rounds', { type: 'number', description: 'Firebase: rounds' })
      .option('mem-cost', { type: 'number', description: 'Firebase: mem_cost' })
      .option('yes', {
        alias: 'y',
        type: 'boolean',
        default: false,
        description: 'Skip the confirmation prompt'
      })
      .example(
        '$0 auth users import auth0-users.ndjson --from auth0 --dry-run',
        'Check an Auth0 export without writing anything'
      )
      .example(
        '$0 auth users import users.json --from firebase --hash-key … --salt-separator Bw== --rounds 8 --mem-cost 14',
        'Import a Firebase export with its hash parameters'
      )
      .example(
        '$0 auth users import users.csv --from clerk --map-connection oauth_google=google -y',
        'Import a Clerk CSV without prompting'
      )
      .showHelpOnFail(false) as any,
  handler: withAuthHints(async args => {
    const text = await readFile(args.file, 'utf8')
    const { total, rows, skipped } = prepare_rows(text, args.from, {
      format: args.format,
      connection_map: parse_connection_map(args['map-connection']),
      firebase: firebase_config(args)
    })

    if (rows.length === 0) {
      throw new Error(`No importable users in ${args.file} (${total} record(s) read)`)
    }

    const dry_run = !!args['dry-run']
    if (!args.yes && !dry_run) {
      const { confirm } = await prompts({
        type: 'toggle',
        name: 'confirm',
        message: `Import ${rows.length} user(s) from ${args.from}?`,
        initial: false,
        active: 'yes',
        inactive: 'no'
      })
      if (!confirm) {
        log.info('Cancelled.')
        return
      }
    }

    const api = await requireAuthAdmin(args)
    const results: RowResult[] = [...skipped]
    for (let start = 0; start < rows.length; start += BATCH_SIZE) {
      const batch = rows.slice(start, start + BATCH_SIZE)
      const res = await api.userImport({
        users: batch.map(b => b.row) as any,
        connection: args.connection,
        update_existing: !!args['update-existing'],
        dry_run
      })
      for (const r of res.results) {
        results.push({
          record: batch[r.index].record,
          email: r.email,
          status: r.status,
          user_id: r.user_id,
          error: r.error
        })
      }
      if (!args.json) {
        log.info(
          `${dry_run ? '🔎 Checked' : '📥 Imported'} ${Math.min(start + BATCH_SIZE, rows.length)}/${rows.length}`
        )
      }
    }
    results.sort((a, b) => a.record - b.record)

    const count = (s: RowResult['status']) => results.filter(r => r.status === s).length
    const summary = {
      records: total,
      created: count('created'),
      updated: count('updated'),
      skipped: count('skipped'),
      errors: count('error')
    }

    if (args.json) {
      print_json({ dry_run, summary, results })
    } else {
      for (const r of results.filter(r => r.status === 'error')) {
        log.error(
          `❌ record ${r.record}${r.email ? ` (${r.email})` : ''}: ${r.error?.code} — ${r.error?.message}`
        )
      }
      log.info(
        `${dry_run ? 'Dry run — nothing written. Would create' : 'Created'} ${summary.created}, ${dry_run ? 'update' : 'updated'} ${summary.updated}, skipped ${summary.skipped} existing, ${summary.errors} error(s) out of ${summary.records} record(s).`
      )
      if (summary.created + summary.updated > 0 && !dry_run) {
        log.info(
          '🔐 Imported passwords are upgraded to argon2id the first time each user signs in.'
        )
      }
    }

    if (summary.errors > 0) {
      // In --json mode stdout must stay one JSON document: the global failure
      // handler would append its message to it. The exit code carries it.
      if (args.json) {
        process.exitCode = 1
        return
      }
      throw new Error(`${summary.errors} record(s) were not imported`)
    }
  })
}
