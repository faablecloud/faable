import axios from 'axios'
import { CommandModule } from 'yargs'
import type { FaableApi } from '../../../api/FaableApi'
import { CliError } from '../../../lib/errors'
import { confirm } from '../../../lib/interactive'
import { json_option, print_json } from '../../../lib/listing'
import { log } from '../../../log'
import {
  app_option,
  require_completed,
  resolve_volume,
  state_label,
  volume_option,
  wait_operation
} from './shared'

const POLL_MS = 3000
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** Polls `get` until `done` says so; the database side has no operation row. */
const poll = async <T>(get: () => Promise<T>, done: (v: T) => boolean) => {
  for (;;) {
    const v = await get()
    if (done(v)) return v
    await sleep(POLL_MS)
  }
}

/** The one ready database of an app, or a clear refusal. */
const database_of = async (
  api: FaableApi,
  team: string,
  app_id: string,
  name: string
) => {
  const { results } = await api.listDatabases(team, app_id)
  const ready = results.filter(d => d.state === 'ready')
  if (ready.length !== 1) {
    throw new CliError(
      'not_found',
      ready.length === 0
        ? `${name} has no ready database to clone ${results.length ? `(it is ${results[0].state})` : ''}`.trim()
        : `${name} has ${ready.length} databases: clone them by hand (database export/import)`
    )
  }
  return ready[0]
}

/**
 * The source database's dump into the target's: export, stream the .sql.gz
 * from its signed download straight to the import's signed upload (nothing
 * on disk), apply — which backs the target database up first.
 */
const clone_database = async (
  api: FaableApi,
  team: string,
  from: { id: string; name: string },
  to: { id: string; name: string },
  quiet: boolean
) => {
  const src = await database_of(api, team, from.id, from.name)
  const dst = await database_of(api, team, to.id, to.name)
  if (!quiet) log.info(`🗃  Exporting ${from.name}'s database`)
  const { export_id } = await api.exportDatabase(team, src.id)
  const exp = await poll(
    () => api.getDatabaseExport(team, src.id, export_id),
    e => e.state === 'completed' || e.state === 'failed'
  )
  if (exp.state !== 'completed' || !exp.url) {
    throw new CliError(
      'operation_failed',
      `The export of ${from.name}'s database failed: ${exp.error ?? 'no reason given'}`
    )
  }
  const imp = await api.importDatabase(team, dst.id)
  if (!quiet)
    log.info(
      `🗃  Loading it into ${to.name}'s database (a backup of it goes first)`
    )
  const download = await axios.get(exp.url, {
    responseType: 'stream',
    timeout: 0
  })
  const length = download.headers['content-length'] ?? exp.size_bytes
  await axios.put(imp.upload_url, download.data, {
    headers: length != null ? { 'content-length': String(length) } : {},
    maxBodyLength: Infinity,
    timeout: 0
  })
  await api.applyDatabaseImport(team, dst.id, imp.import_id)
  const done = await poll(
    () => api.getDatabaseImport(team, dst.id, imp.import_id),
    i => i.state === 'completed' || i.state === 'failed'
  )
  if (done.state !== 'completed') {
    throw new CliError(
      'operation_failed',
      `The import into ${to.name}'s database failed: ${done.error ?? 'no reason given'}`
    )
  }
  return { export_id, import_id: imp.import_id }
}

interface CloneArgs {
  from: string
  app?: string
  volume?: string
  backup?: string
  database?: boolean
  yes?: boolean
  json?: boolean
}

export const volumes_clone: CommandModule<unknown, CloneArgs> = {
  command: 'clone',
  describe:
    "Make an app a copy of another of the project: its volume (and with --database its database) replaced by the other's",
  builder: yargs =>
    volume_option(app_option(json_option(yargs)))
      .option('from', {
        type: 'string',
        demandOption: true,
        description: 'The app to copy (id, name or slug), in the same project'
      })
      .option('backup', {
        type: 'string',
        description:
          'Copy one of its backups instead of what it holds now (see volumes backups -a <it>)'
      })
      .option('database', {
        type: 'boolean',
        default: false,
        description: "Its database's data too (each app has its own)"
      })
      .option('yes', {
        alias: 'y',
        type: 'boolean',
        default: false,
        description: 'Skip the confirmation prompt'
      })
      .example(
        '$0 deploy volumes clone --from my-blog --database -a my-blog-staging',
        'A WordPress staging: the files and the database of my-blog'
      )
      .showHelpOnFail(false) as any,
  handler: async args => {
    const to = await resolve_volume(args.app, args.volume)
    const from = await resolve_volume(args.from, args.volume)
    if (from.app_id === to.app_id) {
      throw new CliError(
        'usage',
        'An app is not cloned onto itself: -a is the copy, --from the original'
      )
    }
    if (from.team !== to.team) {
      throw new CliError(
        'usage',
        `${from.app.name} and ${to.app.name} are in different projects`
      )
    }
    const { api, team } = to
    const go = await confirm({
      message: `Replace everything in ${to.app.name}/${to.volume.name}${args.database ? ' and its database' : ''} with a copy of ${from.app.name}${args.backup ? ` (backup ${args.backup})` : ''}? ${to.app.name} stops while it restores; what it holds now is backed up first.`,
      yes: args.yes
    })
    if (!go) {
      log.info('Cancelled.')
      return
    }
    const quiet = !!args.json
    const onState = (s: keyof typeof state_label) => {
      if (!quiet && s !== 'completed' && s !== 'failed')
        log.info(state_label[s])
    }

    let backup_id = args.backup
    if (!backup_id) {
      if (!quiet)
        log.info(`🗄  Backing up ${from.app.name}/${from.volume.name}, the copy`)
      const b = await api.createVolumeOperation(team, from.volume.id, 'backup')
      backup_id = require_completed(
        await wait_operation(api, team, b, { onState })
      ).id
    }
    if (!quiet)
      log.info(
        `♻️  Restoring it into ${to.app.name}/${to.volume.name} (its current contents are backed up first)`
      )
    const r = await api.restoreVolume(team, to.volume.id, backup_id)
    const restored = require_completed(
      await wait_operation(api, team, r, { onState })
    )

    const db = args.database
      ? await clone_database(
          api,
          team,
          { id: from.app_id, name: from.app.name },
          { id: to.app_id, name: to.app.name },
          quiet
        )
      : null

    if (args.json)
      return print_json({ backup_id, restore: restored, database: db })
    log.info(`✅ ${to.app.name} is a copy of ${from.app.name}.`)
    log.info(
      `To undo the files: faable deploy volumes restore ${restored.after_id ?? '<the backup before it>'} -a ${to.app.name}`
    )
    // Files and data come as they are, and some of them name the original.
    log.info(
      `⚠️  What names ${from.app.name}'s domain came along: in a WordPress, a WP_HOME in wp-config-local.php, and the links in the database. ` +
        `faable deploy run -a ${to.app.name} -- wp search-replace https://${from.app.url} https://${to.app.url} --all-tables`
    )
  }
}
