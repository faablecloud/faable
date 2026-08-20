import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { CommandModule } from 'yargs'
import { requireApi } from '../../../api/context'
import { log } from '../../../log'
import { resolve_app_id } from '../resolve_app_id'
import { managed_warning } from './managed_names'
import { merge_app_secrets } from './merge'
import { parse_env } from './parse_env'
import { SecretPair, parse_pairs } from './parse_pairs'

interface SecretsSetArgs {
  pairs?: string[]
  app?: string
  'env-file'?: string
}

// `--env-file` with no value means "the .env in this directory", the case
// people actually have.
const DEFAULT_ENV_FILE = '.env'

const read_env_file = (raw_path: string): SecretPair[] => {
  const path = raw_path || DEFAULT_ENV_FILE
  let content: string
  try {
    content = readFileSync(resolve(path), 'utf8')
  } catch (err) {
    const code = (err as { code?: string }).code
    if (code === 'ENOENT') {
      throw new Error(`No such file: ${path}`, { cause: err })
    }
    if (code === 'EISDIR') {
      throw new Error(`${path} is a directory, expected a .env file.`, {
        cause: err
      })
    }
    throw err
  }
  return parse_env(content, path)
}

// Both sources upserted into one list, arguments last so an explicit
// KEY=VALUE on the command line overrides the same name in the file.
const combine = (from_file: SecretPair[], from_args: SecretPair[]) => {
  const merged = new Map(from_file.map(p => [p.name, p.value]))
  for (const { name, value } of from_args) merged.set(name, value)
  return [...merged.entries()].map(([name, value]) => ({ name, value }))
}

// One line per secret reads well for a handful; a whole .env would bury the
// summary under eighty lines.
const MAX_DETAILED = 10

export const secrets_set: CommandModule<unknown, SecretsSetArgs> = {
  command: 'set [pairs...]',
  describe: 'Set secrets as KEY=VALUE pairs or from a .env file',
  builder: yargs =>
    yargs
      .positional('pairs', {
        type: 'string',
        array: true,
        description: 'KEY=VALUE pairs (quote values containing spaces)'
      })
      .option('app', {
        alias: 'a',
        type: 'string',
        description: 'App Identifier (defaults to the linked app)'
      })
      .option('env-file', {
        alias: 'f',
        type: 'string',
        description: 'Load variables from a .env file (defaults to ./.env)'
      })
      .example('$0 deploy secrets set API_KEY=abc123', 'Set a single secret')
      .example(
        '$0 deploy secrets set A=1 DB_URL=postgres://u:p@host/db',
        'Set several at once (values may contain "=")'
      )
      .example(
        '$0 deploy secrets set --env-file',
        'Upload every variable in ./.env'
      )
      .example(
        '$0 deploy secrets set -f .env.production',
        'Upload another env file'
      )
      .showHelpOnFail(false) as any,
  handler: async args => {
    const env_file = args['env-file']
    const pairs = args.pairs ?? []
    if (env_file === undefined && pairs.length === 0) {
      throw new Error(
        'Nothing to set. Pass KEY=VALUE pairs or --env-file [path] to load a .env file.'
      )
    }

    // Validate EVERYTHING before writing ANY, so one malformed line or pair
    // aborts the whole command with no partial writes.
    const from_file = env_file === undefined ? [] : read_env_file(env_file)
    const parsed = combine(from_file, parse_pairs(pairs))

    if (env_file !== undefined) {
      const path = env_file || DEFAULT_ENV_FILE
      if (from_file.length === 0) {
        throw new Error(`${path} has no variables to set.`)
      }
      log.info(`📄 Read ${from_file.length} variable(s) from ${path}`)
    }

    // Warn BEFORE the write: a reserved name is accepted and stored, but the
    // controller drops it when it builds the pod — without this line the
    // command looks like it worked.
    for (const { name } of parsed) {
      const warning = managed_warning(name)
      if (warning) log.warn(`⚠️  ${warning}`)
    }

    const ctx = await requireApi()
    const app_id = await resolve_app_id(args.app, ctx.appId, ctx.api)

    // getApp also validates access to the app and provides the team the
    // batch endpoint requires as request context.
    const app = await ctx.api.getApp(app_id)
    const existing = await ctx.api.getAppSecrets(app_id)
    const merged = merge_app_secrets(existing, parsed)
    await ctx.api.createSecretsBatch(app.id, app.team, merged)

    const current = new Set(
      existing.filter(s => s.related_model === 'app').map(s => s.name)
    )
    const updated = parsed.filter(({ name }) => current.has(name)).length
    if (parsed.length <= MAX_DETAILED) {
      for (const { name } of parsed) {
        log.info(
          current.has(name)
            ? `🔑 Updated secret ${name} on ${app_id}`
            : `🔑 Added secret ${name} to ${app_id}`
        )
      }
    } else {
      log.info(`🔑 ${parsed.length - updated} added, ${updated} updated`)
    }
    log.info(`✅ ${parsed.length} secret(s) saved to ${app_id}.`)
    log.info(`ℹ️ The app is restarting to apply the changes.`)
  }
}
