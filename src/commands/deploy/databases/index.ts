import { Argv, CommandModule } from 'yargs'
import { FaableDatabase } from '../../../api/FaableApi'
import { json_option, print, print_json } from '../../../lib/listing'
import { log } from '../../../log'
import { app_option, resolve_app } from '../schedule/shared'
import { format_bytes } from '../volumes/operation'

// The managed database of a code app (api `/app/:id/database`, `/database`):
// MariaDB, or Postgres where the platform offers it. The app gets its
// connection as platform-managed FAABLE_DATABASE_* variables on its next
// deployment; the password is never shown. Moving data in and out:
// export and import are in the dashboard for now (arch/database D-10).

const ENGINE: Record<string, string> = {
  mariadb: 'MariaDB',
  postgres: 'PostgreSQL'
}

const describe_db = (d: FaableDatabase) => {
  print(`  ${d.name ?? d.id}  ${ENGINE[d.engine] ?? d.engine}  ${d.state}`)
  const notes = [
    d.id,
    d.tier ? `tier ${d.tier}` : null,
    d.connections != null ? `up to ${d.connections} connections` : null,
    d.host ? `${d.host}:${d.port}` : null,
    d.state === 'retained' ? `RETAINED until ${d.retain_until ?? '?'}` : null
  ].filter(Boolean)
  print(`    ${notes.join(' · ')}`)
}

interface Args {
  app?: string
  json?: boolean
}

const databases_list: CommandModule<unknown, Args> = {
  command: 'list',
  describe: 'List the databases of the app',
  builder: yargs =>
    app_option(json_option(yargs))
      .example('$0 deploy databases list -a my-api', 'Databases of my-api')
      .showHelpOnFail(false) as any,
  handler: async args => {
    const { api, app, app_id, team } = await resolve_app(args.app)
    const { results } = await api.listDatabases(team, app_id)
    if (args.json) return print_json({ results })
    if (results.length === 0) {
      log.info(
        `🗄️  ${app.name} has no database. Create one with: faable deploy databases create -a ${app.name}`
      )
      return
    }
    log.info(`🗄️  ${results.length} database(s) of ${app.name}:`)
    results.forEach(describe_db)
  }
}

interface CreateArgs extends Args {
  engine?: 'mariadb' | 'postgres'
  tier?: string
}

const databases_create: CommandModule<unknown, CreateArgs> = {
  command: 'create',
  describe:
    'Give the app a managed database (MariaDB, or PostgreSQL where it is offered)',
  builder: (yargs: Argv) =>
    app_option(json_option(yargs))
      .option('engine', {
        type: 'string',
        choices: ['mariadb', 'postgres'] as const,
        description: 'The database server; MariaDB by default'
      })
      .option('tier', {
        type: 'string',
        description:
          "The database tier (db-s, db-m…); the plan's default if omitted"
      })
      .example(
        '$0 deploy databases create -a my-api --engine postgres',
        'A PostgreSQL database for my-api'
      )
      .showHelpOnFail(false) as any,
  handler: async args => {
    const { api, app, app_id, team } = await resolve_app(args.app)
    if (args.engine === 'postgres')
      log.info('⏳ Creating the PostgreSQL database (about half a minute)…')
    const db = await api.attachDatabase(team, app_id, {
      ...(args.engine ? { engine: args.engine } : {}),
      ...(args.tier ? { tier: args.tier } : {})
    })
    if (args.json) return print_json(db)
    log.info(
      `✅ ${app.name} has its ${ENGINE[db.engine] ?? db.engine} database:`
    )
    describe_db(db)
    print('')
    print(
      '  Your app gets FAABLE_DATABASE_URL (and _HOST, _PORT, _NAME, _USER, _PASSWORD, _CA_FILE)'
    )
    print(
      '  on its next deployment, with TLS verified against the server. Your own variables are not touched.'
    )
  }
}

const databases_info: CommandModule<unknown, Args> = {
  command: 'info',
  describe: 'Where the app’s database connects and how big it is',
  builder: yargs =>
    app_option(json_option(yargs))
      .example('$0 deploy databases info -a my-api', 'The database of my-api')
      .showHelpOnFail(false) as any,
  handler: async args => {
    const { api, app, app_id, team } = await resolve_app(args.app)
    const { results } = await api.listDatabases(team, app_id)
    const db = results.find(d => d.state !== 'retained') ?? results[0]
    if (!db) {
      log.info(`🗄️  ${app.name} has no database.`)
      return
    }
    const usage =
      db.state === 'ready'
        ? await api.getDatabaseUsage(team, db.id).catch(() => null)
        : null
    if (args.json) return print_json({ ...db, usage })
    describe_db(db)
    print(
      `    database ${db.name} · user ${db.user} · password managed by the platform`
    )
    print(
      usage
        ? `    ${format_bytes(usage.size_bytes)} in ${usage.tables} table(s), measured ${usage.measured_at}`
        : '    size not available right now'
    )
  }
}

export const databases: CommandModule = {
  command: 'databases <command>',
  describe: "Manage the app's managed database: list, create, info",
  builder: yargs =>
    yargs
      .command(databases_list)
      .command(databases_create)
      .command(databases_info)
      .demandCommand(1, 'Specify a databases command: list, create or info'),
  handler: () => {
    // Unreachable: demandCommand(1) routes to a subcommand or fails.
  }
}
