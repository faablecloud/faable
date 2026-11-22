import { CommandModule } from 'yargs'

// The CLI described as data — what `faable commands --json` prints, and the
// catalog an agent searches before it calls anything (the `search()` of
// arch/deploy/cli-code-mode-plan.md). It is read from the same CommandModule
// tree yargs runs: every builder is handed a recorder instead of a parser, so
// the catalog cannot drift from the commands. Nothing is parsed or run.

export interface CatalogArg {
  name: string
  aliases: string[]
  type?: string
  describe?: string
  required: boolean
  array: boolean
  choices?: unknown[]
  default?: unknown
}

export interface CatalogCommand {
  // The words after `faable`, canonical names only: `deploy apps list`.
  path: string
  aliases: string[]
  describe: string
  positionals: CatalogArg[]
  options: CatalogArg[]
  // The command is the default of its group: `faable deploy` runs
  // `deploy launch`.
  default_of_group: boolean
  // Out of the help (`describe: false`): kept for programs that already call
  // it, or for the MCP alone (`deploy waf add`). Listed only on request.
  hidden: boolean
  // The module yargs runs for it (not printed).
  module: CommandModule<any, any>
}

interface Recorded {
  commands: CommandModule[]
  options: Map<string, any>
  positionals: Map<string, any>
}

// A stand-in for the yargs instance a builder receives: it keeps what the
// builder declares (subcommands, options, positionals) and accepts every
// other call (.example, .check, .conflicts…) without doing anything, so a
// builder runs to the end whatever else it configures.
const recorder = (rec: Recorded): any => {
  const proxy: any = new Proxy(
    {},
    {
      get(_t, key) {
        if (key === 'command')
          return (mod: any) => {
            if (typeof mod === 'object' && mod) rec.commands.push(mod)
            return proxy
          }
        if (key === 'option' || key === 'options')
          return (name: any, opts: any = {}) => {
            if (typeof name === 'string') rec.options.set(name, opts)
            else
              for (const [k, v] of Object.entries(name ?? {}))
                rec.options.set(k, v)
            return proxy
          }
        if (key === 'positional')
          return (name: string, opts: any = {}) => {
            rec.positionals.set(name, opts)
            return proxy
          }
        // `then` must stay undefined or `await builder(proxy)` would treat
        // the recorder as a promise.
        if (key === 'then') return undefined
        return () => proxy
      }
    }
  )
  return proxy
}

const as_list = (v: unknown): string[] =>
  v === undefined ? [] : Array.isArray(v) ? v.map(String) : [String(v)]

// `apps <command>`, `rm <id>`, `logs [app_id]` → name and declared
// positionals (required for <x>, optional for [x], variadic for ..).
const parse_command = (mod: CommandModule) => {
  const forms = as_list(mod.command)
  const is_default = forms.some(f => f.split(' ')[0] === '$0')
  const named = forms.filter(f => f.split(' ')[0] !== '$0')
  const [first, ...rest] = named.length ? named : forms
  const [name, ...params] = first.split(/\s+/)
  const positionals = params.map(p => ({
    // `<ids..>` and `[pairs...]` are both variadic.
    name: p.replace(/^[<[]|[>\]]$/g, '').replace(/\.{2,}$/, ''),
    required: p.startsWith('<'),
    array: p.includes('..')
  }))
  const aliases = [
    ...rest.map(f => f.split(/\s+/)[0]),
    ...as_list((mod as any).aliases)
  ]
  return { name, positionals, aliases, is_default }
}

const arg = (
  name: string,
  opts: any,
  base: Partial<CatalogArg> = {}
): CatalogArg => {
  const out: CatalogArg = {
    name,
    aliases: as_list(opts.alias),
    type:
      opts.type ??
      (opts.boolean
        ? 'boolean'
        : opts.string
          ? 'string'
          : opts.number
            ? 'number'
            : undefined),
    describe: opts.describe ?? opts.description ?? opts.desc,
    required: Boolean(
      opts.demandOption ?? opts.required ?? opts.demand ?? base.required
    ),
    array: Boolean(opts.array ?? base.array)
  }
  if (opts.choices) out.choices = opts.choices
  if (opts.default !== undefined && typeof opts.default !== 'function')
    out.default = opts.default
  return out
}

const visible = (opts: any) => !opts.hidden

// Walks a group: every command, depth first. A command whose builder
// registers subcommands is a group, not something to call, and is left out;
// its default subcommand is listed under its own name, flagged. A hidden
// group hides everything under it.
export const walk = (
  roots: CommandModule<any, any>[],
  prefix: string[] = [],
  parent_hidden = false
) => {
  const out: CatalogCommand[] = []
  for (const mod of roots) {
    const hidden = parent_hidden || mod.describe === false
    const { name, positionals, aliases, is_default } = parse_command(mod)
    const rec: Recorded = {
      commands: [],
      options: new Map(),
      positionals: new Map()
    }
    const builder: any = mod.builder
    if (typeof builder === 'function') builder(recorder(rec))
    else if (builder && typeof builder === 'object')
      for (const [k, v] of Object.entries(builder)) rec.options.set(k, v)
    const path = [...prefix, name]
    if (rec.commands.length) {
      out.push(...walk(rec.commands, path, hidden))
      continue
    }
    out.push({
      path: path.join(' '),
      aliases,
      describe: String(mod.describe ?? ''),
      positionals: positionals.map(p =>
        arg(p.name, rec.positionals.get(p.name) ?? {}, p)
      ),
      options: [...rec.options]
        .filter(([, o]) => visible(o))
        .map(([n, o]) => arg(n, o)),
      default_of_group: is_default,
      hidden,
      module: mod
    })
  }
  return out
}

// Every word of the query has to appear in the command's path, description
// or one of its flags — `--filter "domain add"` finds `deploy domains add`.
export const matches = (cmd: CatalogCommand, query: string) => {
  const hay = [
    cmd.path,
    ...cmd.aliases,
    cmd.describe,
    ...cmd.options.map(o => o.name)
  ]
    .join(' ')
    .toLowerCase()
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every(w => hay.includes(w.replace(/s$/, '')))
}
