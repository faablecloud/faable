import { CommandModule } from 'yargs'
import { version } from '../../config'
import { CatalogArg, CatalogCommand, matches, walk } from '../../lib/catalog'
import { EFFECTS, Effect } from '../../lib/effects'
import { CliError } from '../../lib/errors'
import { json_option, print, print_json } from '../../lib/listing'

interface CommandsArgs {
  query?: string[]
  effect?: Effect[]
  hidden?: boolean
  json?: boolean
}

// What a program needs to call a command, and nothing it would pay tokens
// for: no empty fields, and `--json` as a boolean rather than one more flag.
const compact_arg = (a: CatalogArg) => {
  const out: Record<string, unknown> = { name: a.name }
  if (a.aliases.length) out.aliases = a.aliases
  if (a.type) out.type = a.type
  if (a.required) out.required = true
  if (a.array) out.array = true
  if (a.choices) out.choices = a.choices
  if (a.default !== undefined && a.default !== false) out.default = a.default
  if (a.describe) out.describe = a.describe
  return out
}

const describe_command = (c: CatalogCommand) => {
  const rule = EFFECTS[c.path]
  const out: Record<string, unknown> = {
    object: 'command',
    path: c.path,
    usage: [
      'faable',
      c.path,
      ...c.positionals.map(p =>
        p.required
          ? `<${p.name}${p.array ? '..' : ''}>`
          : `[${p.name}${p.array ? '..' : ''}]`
      )
    ].join(' '),
    describe: c.describe,
    effect: rule?.effect,
    json: c.options.some(o => o.name === 'json')
  }
  if (rule?.read_when) out.read_when = rule.read_when
  if (c.aliases.length) out.aliases = c.aliases
  if (c.default_of_group) out.default_of_group = true
  if (c.hidden) out.hidden = true
  if (c.positionals.length) out.positionals = c.positionals.map(compact_arg)
  const options = c.options.filter(o => o.name !== 'json').map(compact_arg)
  if (options.length) out.options = options
  return out
}

// The flags every command takes (src/index.ts), said once rather than 130
// times.
const GLOBAL_OPTIONS = [
  {
    name: 'project',
    aliases: ['p'],
    type: 'string',
    describe: 'Project to act on, id or name (env FAABLE_PROJECT)'
  },
  {
    name: 'non-interactive',
    type: 'boolean',
    describe:
      'Never prompt nor infer the app from the working directory; errors as JSON (env FAABLE_NONINTERACTIVE=1)'
  },
  {
    name: 'config',
    aliases: ['c'],
    type: 'string',
    describe: 'Path to the local `faable.json` file'
  }
]

// `faable commands` — the CLI described as data, for agents: search it, then
// call what it found. Read from the same command tree the CLI runs
// (src/lib/catalog.ts), with what each command does to Faable
// (src/lib/effects.ts).
export const commands: CommandModule<unknown, CommandsArgs> = {
  command: 'commands [query..]',
  describe:
    'List the CLI commands, with their flags and whether they change anything (search: add words)',
  builder: yargs =>
    json_option(yargs)
      .positional('query', {
        type: 'string',
        array: true,
        description:
          'Words that must all appear in the command, its description or its flags'
      })
      .option('effect', {
        type: 'string',
        array: true,
        choices: ['read', 'write', 'destructive', 'local'],
        description: 'Only commands with this effect (repeatable)'
      })
      .option('hidden', {
        type: 'boolean',
        default: false,
        description: 'Also list the commands kept out of the help'
      })
      .example(
        '$0 commands domain --json',
        'Every command about domains, as JSON'
      )
      .example(
        '$0 commands --effect read',
        'What can be run without changing anything'
      ) as any,
  handler: async args => {
    // Imported here: the root list registers this very command.
    const { ROOT_COMMANDS } = await import('../root')
    const query = (args.query ?? []).join(' ')
    const found = walk(ROOT_COMMANDS)
      .filter(c => args.hidden || !c.hidden)
      .filter(c => !query || matches(c, query))
      .filter(
        c =>
          !args.effect?.length || args.effect.includes(EFFECTS[c.path]?.effect)
      )
    if (args.json) {
      print_json({
        object: 'list',
        data: found.map(describe_command),
        has_more: false,
        next_cursor: null,
        cli_version: version,
        global_options: GLOBAL_OPTIONS
      })
      return
    }
    if (!found.length)
      throw new CliError(
        'not_found',
        `No command matches "${query}". Try fewer words, or \`faable commands\` for all.`
      )
    const width = Math.max(...found.map(c => c.path.length))
    for (const c of found) {
      const effect = EFFECTS[c.path]?.effect ?? '?'
      print(
        `faable ${c.path.padEnd(width)}  ${effect.padEnd(11)}  ${c.describe}`
      )
    }
  }
}
