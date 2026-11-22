import type {
  QuickJSContext,
  QuickJSDeferredPromise,
  QuickJSHandle,
  QuickJSWASMModule
} from 'quickjs-emscripten-core'
import { CatalogArg, CatalogCommand, matches, walk } from '../lib/catalog'
import { EFFECTS, Effect, effect_of } from '../lib/effects'
import { Permission, permission_of } from './oauth'
import { CliError, CliResult, RunOptions } from './run_cli'
import { TOOLS } from './tools'

// Code Mode on the hosted MCP server (`?mode=code`, arch/deploy/
// cli-code-mode-plan.md F5): instead of 80 tools, two — `search` finds CLI
// commands and returns them as TypeScript signatures, `execute` runs the
// agent's JavaScript in QuickJS (WASM) inside this process. The only thing
// that code reaches is the `faable` object: one function per CLI command,
// and each call is one `run_cli`, exactly like a tool — same credential,
// same `x-faable-client` (`faable-mcp-code`), same write gate.
//
// What the object holds is an allowlist, not the CLI:
//  - the commands the hosted tools already run (those are the ones vetted
//    for a server that runs children with someone else's key), minus the
//    destructive ones — nobody is asked before a call inside `execute`;
//  - of their options, all but the ones that reach this machine or redirect
//    the request (BLOCKED_OPTIONS). code_mode.test.ts pins the exposed list,
//    so a new option is a decision, not an accident.

// ── The commands ──────────────────────────────────────────────────────────

// Options no `execute` may pass. Globally: `--config` reads a file of this
// pod, `--workdir` points the CLI at its disk, `--auth-url` sends the
// caller's token to another host, `--follow` never ends. `--show` prints
// secret values, which the hosted tools never do either.
const BLOCKED_OPTIONS: Record<string, string[]> = {
  '*': ['json', 'config', 'workdir', 'auth-url', 'follow'],
  'deploy secrets list': ['show']
}
// Only this value: the .env document comes on stdin, never from a file here.
const ONLY_VALUE: Record<string, Record<string, string>> = {
  'deploy secrets set': { 'env-file': '-' }
}

export type CallClass = 'read' | 'deploy' | 'write'

export interface CodeCommand {
  path: string
  // `deploy apps set-password` → ['deploy', 'apps', 'setPassword']
  js: string[]
  describe: string
  // The most it can do (src/lib/effects.ts).
  effect: Effect
  // A read for some arguments (`deploy install` without an app).
  read_when?: string
  product: 'deploy' | 'auth'
  // A write that is a deploy (trigger, redeploy, cancel): allowed without
  // the reversible writes, as deploy_app is.
  deploys: boolean
  positionals: CatalogArg[]
  options: CatalogArg[]
  // `--yes` is passed for it: there is nobody to answer a prompt.
  yes: boolean
  // Some hosted tool of this command fences its output as third-party text.
  untrusted: boolean
}

// `starting-after` → `startingAfter`, `user_ids` → `userIds`.
export const camel = (s: string) =>
  s.replace(/[-_]([a-z0-9])/g, (_m, c: string) => c.toUpperCase())

let catalog_cache: CatalogCommand[] | undefined
// The CLI's own tree, walked once. Imported here, not at the top: the root
// command list includes `faable mcp`, which imports this module.
const load_catalog = async () => {
  if (!catalog_cache) {
    const { ROOT_COMMANDS } = await import('../commands/root')
    catalog_cache = walk(ROOT_COMMANDS)
  }
  return catalog_cache
}

// The catalog path a tool's command runs (`deploy install restore` is
// `deploy install` with its first positional).
const path_of_tool = (words: string[], paths: Set<string>) => {
  for (let n = words.length; n > 0; n--) {
    const p = words.slice(0, n).join(' ')
    if (paths.has(p)) return p
  }
  return undefined
}

export const build_code_commands = (catalog: CatalogCommand[]) => {
  const by_path = new Map(catalog.map(c => [c.path, c]))
  const tools_of = new Map<string, typeof TOOLS>()
  for (const t of TOOLS) {
    if (t.local_only) continue
    const p = path_of_tool(t.command, new Set(by_path.keys()))
    if (p) tools_of.set(p, [...(tools_of.get(p) ?? []), t])
  }
  const out: CodeCommand[] = []
  for (const [path, tools] of [...tools_of].sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    const rule = EFFECTS[path]
    const cmd = by_path.get(path)
    if (
      !rule ||
      !cmd ||
      rule.effect === 'destructive' ||
      rule.effect === 'local'
    )
      continue
    const blocked = new Set([
      ...BLOCKED_OPTIONS['*'],
      ...(BLOCKED_OPTIONS[path] ?? [])
    ])
    out.push({
      path,
      js: path.split(' ').map(camel),
      describe: cmd.describe,
      effect: rule.effect,
      read_when: rule.read_when,
      product: path.startsWith('auth ') ? 'auth' : 'deploy',
      deploys: tools.some(t => permission_of(t) === 'deploy:deploy'),
      positionals: cmd.positionals,
      options: cmd.options.filter(
        o => !blocked.has(o.name) && o.name !== 'yes'
      ),
      yes: cmd.options.some(o => o.name === 'yes'),
      untrusted: tools.some(t => !!t.untrusted)
    })
  }
  return out
}

let commands_cache: CodeCommand[] | undefined
export const code_commands = async () =>
  (commands_cache ??= build_code_commands(await load_catalog()))

// ── What a connection may call ────────────────────────────────────────────

export interface CodeAccess {
  // The reversible writes (`?mode=code,write`, or an OAuth connection).
  writes?: boolean
  // Reads only — not even a deploy (`?readonly=1`).
  readonly?: boolean
  // An OAuth connection: what its consent allows.
  granted?: Permission[]
}

const permission_for = (c: CodeCommand, cls: CallClass): Permission =>
  cls === 'read'
    ? `${c.product}:read`
    : cls === 'deploy'
      ? 'deploy:deploy'
      : `${c.product}:write`

const class_of = (c: CodeCommand, effect: Effect | undefined): CallClass =>
  effect === 'read' ? 'read' : c.deploys ? 'deploy' : 'write'

// Why this call may not run, or undefined if it may.
export const refusal = (
  c: CodeCommand,
  cls: CallClass,
  access: CodeAccess
): string | undefined => {
  if (cls !== 'read' && access.readonly)
    return `${c.path} changes something, and this connection is read-only (?readonly=1).`
  if (cls === 'write' && !access.writes)
    return `${c.path} is a write: it needs a connection with writes (?mode=code,write with an API key, or an OAuth connection that allows ${permission_for(c, cls)}).`
  const p = permission_for(c, cls)
  if (access.granted && !access.granted.includes(p))
    return `This connection was not allowed ${p}. Reconnect and allow it on the Faable consent screen.`
  return undefined
}

// On the `faable` object at all: it can run for some arguments.
export const available = (c: CodeCommand, access: CodeAccess) =>
  !refusal(c, class_of(c, c.effect), access) ||
  (!!c.read_when && !refusal(c, 'read', access))

// ── From a JavaScript call to argv ────────────────────────────────────────

export class CallError extends Error {}

const plain = (name: string, v: unknown, positional: boolean): string => {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  if (typeof v !== 'string')
    throw new CallError(`\`${name}\` must be a string, got ${typeof v}`)
  if (positional && (v === '' || v.startsWith('-')))
    throw new CallError(
      `\`${name}\` cannot be empty nor start with "-": ${JSON.stringify(v)}`
    )
  return v
}

const check_choice = (a: CatalogArg, v: string) => {
  if (a.choices && !a.choices.map(String).includes(v))
    throw new CallError(
      `\`${camel(a.name)}\` must be one of ${a.choices.map(c => JSON.stringify(c)).join(', ')}`
    )
}

export interface CallPlan {
  argv: string[]
  stdin?: string
  effect: Effect | undefined
  timeout_ms: number
}

// `{ app: 'web', latest: true }` → ['deploy', 'apps', 'list', '--latest', …].
// Every value goes as `--name=value`, so no value is ever read as a flag;
// positionals that look like one are refused.
export const plan_call = (
  c: CodeCommand,
  raw: unknown,
  project?: string
): CallPlan => {
  if (
    raw !== undefined &&
    (raw === null || typeof raw !== 'object' || Array.isArray(raw))
  )
    throw new CallError(
      `faable.${c.js.join('.')}() takes one object of named arguments`
    )
  const args = { ...((raw as Record<string, unknown>) ?? {}) }
  const take = (name: string) => {
    for (const k of [camel(name), name]) {
      if (k in args) {
        const v = args[k]
        delete args[k]
        return v
      }
    }
    return undefined
  }
  const argv = [...c.path.split(' ')]
  const named: Record<string, unknown> = {}

  let gap: string | undefined
  for (const p of c.positionals) {
    const v = take(p.name)
    if (v === undefined || v === null) {
      if (p.required) throw new CallError(`\`${camel(p.name)}\` is required`)
      gap ??= p.name
      continue
    }
    if (gap)
      throw new CallError(
        `\`${camel(p.name)}\` needs \`${camel(gap)}\` before it`
      )
    const values = p.array && Array.isArray(v) ? v : [v]
    for (const x of values) {
      const s = plain(camel(p.name), x, true)
      check_choice(p, s)
      argv.push(s)
    }
    named[p.name] = v
  }

  const stdin = take('stdin')
  if (stdin !== undefined && typeof stdin !== 'string')
    throw new CallError('`stdin` must be a string')
  const proj = take('project')
  if (proj !== undefined) plain('project', proj, false)

  for (const o of c.options) {
    const v = take(o.name)
    if (v === undefined || v === null) continue
    const only = ONLY_VALUE[c.path]?.[o.name]
    if (only !== undefined && v !== only)
      throw new CallError(
        `\`${camel(o.name)}\` can only be ${JSON.stringify(only)} here`
      )
    named[o.name] = v
    if (o.type === 'boolean') {
      if (typeof v !== 'boolean')
        throw new CallError(`\`${camel(o.name)}\` must be true or false`)
      argv.push(v ? `--${o.name}` : `--no-${o.name}`)
      continue
    }
    const values = o.array && Array.isArray(v) ? v : [v]
    for (const x of values) {
      if (o.type === 'number' && typeof x !== 'number')
        throw new CallError(`\`${camel(o.name)}\` must be a number`)
      const s = plain(camel(o.name), x, false)
      check_choice(o, s)
      argv.push(`--${o.name}=${s}`)
    }
  }

  const unknown = Object.keys(args)
  if (unknown.length)
    throw new CallError(
      `faable.${c.js.join('.')}() has no ${unknown.map(k => `\`${k}\``).join(', ')}. ` +
        `It takes: ${[...c.positionals, ...c.options]
          .map(a => camel(a.name))
          .concat('project')
          .join(', ')}`
    )

  // A pinned project wins over whatever the code passes.
  const p = project ?? (proj as string | undefined)
  if (p) argv.push(`--project=${p}`)
  if (c.yes) argv.push('--yes')

  return {
    argv,
    ...(typeof stdin === 'string' ? { stdin } : {}),
    effect: effect_of(c.path, named),
    // A call that waits for a build may take minutes, like the tools that do.
    timeout_ms: named.wait === true ? 900_000 : 120_000
  }
}

// ── search(): the commands as TypeScript ──────────────────────────────────

const ts_type = (a: CatalogArg) => {
  const base = a.choices
    ? a.choices.map(c => JSON.stringify(c)).join(' | ')
    : a.type === 'boolean'
      ? 'boolean'
      : a.type === 'number'
        ? 'number'
        : 'string'
  return a.array ? `${base} | ${a.choices ? `(${base})` : base}[]` : base
}

const one_line = (s?: string) => (s ?? '').replace(/\s+/g, ' ').trim()

export const signature = (c: CodeCommand) => {
  const fields = [
    ...c.positionals.map(a => ({ a, req: a.required })),
    ...c.options.map(a => ({ a, req: a.required }))
  ].map(({ a, req }) => {
    const only = ONLY_VALUE[c.path]?.[a.name]
    const type = only ? JSON.stringify(only) : ts_type(a)
    const note = [
      one_line(a.describe),
      a.default !== undefined ? `default ${JSON.stringify(a.default)}` : ''
    ]
      .filter(Boolean)
      .join(' — ')
    return `  ${camel(a.name)}${req ? '' : '?'}: ${type}${note ? ` // ${note}` : ''}`
  })
  fields.push(
    '  project?: string // project id or name (pinned connections ignore it)'
  )
  if (c.path === 'deploy secrets set' || c.path === 'auth users set-password')
    fields.push(
      '  stdin?: string // piped to the command (a .env document; a password)'
    )
  const required =
    c.positionals.some(p => p.required) || c.options.some(o => o.required)
  const effect = c.read_when
    ? `${c.effect}; read ${c.read_when}`
    : c.deploys
      ? 'deploy'
      : c.effect
  return [
    `/** ${one_line(c.describe)} (${effect}) */`,
    `faable.${c.js.join('.')}(args${required ? '' : '?'}: {`,
    ...fields,
    `}): Promise<any>`
  ].join('\n')
}

const MAX_SIGNATURES = 8

export const search_text = async (query: string, access: CodeAccess) => {
  const all = (await code_commands()).filter(c => available(c, access))
  const q = query.trim()
  // The catalog matcher works on the CLI's words; the code's names are the
  // same words in camelCase.
  const words = q
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/\./g, ' ')
    .replace(/\bfaable\b/g, '')
    .split(/\s+/)
    .filter(Boolean)
  // Every word, as `faable commands` does; failing that, the commands that
  // have the most of them ("analytics paths traffic" still finds traffic).
  const scored = all.map(c => {
    const cmd = {
      path: c.path,
      aliases: [],
      describe: c.describe,
      options: c.options
    } as any
    return { c, n: words.filter(w => matches(cmd, w)).length }
  })
  const best = Math.max(0, ...scored.map(s => s.n))
  const found = words.length
    ? scored.filter(s => best > 0 && s.n === best).map(s => s.c)
    : all
  if (!found.length)
    return `No command matches "${q}". Try other words, or search("") for every command.`
  const shown = q ? found.slice(0, MAX_SIGNATURES) : []
  const rest = q ? found.slice(MAX_SIGNATURES) : found
  return [
    ...shown.map(signature),
    ...(rest.length
      ? [
          (shown.length
            ? `\n${rest.length} more — search for one by name to see its arguments:\n`
            : '') +
            rest
              .map(c => `faable.${c.js.join('.')}() — ${one_line(c.describe)}`)
              .join('\n')
        ]
      : [])
  ].join('\n\n')
}

// ── execute(): the sandbox ────────────────────────────────────────────────

export interface ExecuteLimits {
  memory_bytes: number
  stack_bytes: number
  // JavaScript run time; waiting for a command does not count.
  cpu_ms: number
  // The whole execute, commands included.
  wall_ms: number
  max_calls: number
  max_in_flight: number
  max_log_chars: number
}

export const DEFAULT_LIMITS: ExecuteLimits = {
  memory_bytes: 64 * 1024 * 1024,
  stack_bytes: 512 * 1024,
  cpu_ms: 10_000,
  wall_ms: 900_000,
  max_calls: 50,
  max_in_flight: 4,
  max_log_chars: 20_000
}

export interface CallRecord {
  command: string
  ok: boolean
  ms: number
  error?: string
}

export type ExecuteResult = {
  logs: string[]
  calls: CallRecord[]
  // A command whose output a third party wrote was called.
  untrusted: boolean
} & ({ ok: true; value: unknown } | { ok: false; error: string })

export interface ExecuteOptions {
  access: CodeAccess
  project?: string
  run: (argv: string[], opts: RunOptions) => Promise<CliResult>
  limits?: Partial<ExecuteLimits>
  error_text: (e: CliError) => string
}

let quickjs: Promise<QuickJSWASMModule> | undefined
// Loaded on the first execute: the rest of the CLI never pays for the WASM.
const load_quickjs = () =>
  (quickjs ??= (async () => {
    const [{ newQuickJSWASMModuleFromVariant }, variant] = await Promise.all([
      import('quickjs-emscripten-core'),
      import('@jitl/quickjs-wasmfile-release-sync')
    ])
    return newQuickJSWASMModuleFromVariant((variant as any).default ?? variant)
  })())

// A function body: `return` the answer. An `async () => {…}` written as the
// whole program is called rather than returned.
export const wrap_code = (code: string) => {
  const t = code.trim()
  const body = /^async\s*(\(\s*\)\s*=>|function\s*\w*\s*\(\s*\))/.test(t)
    ? `return await (${t.replace(/;\s*$/, '')})()`
    : code
  return `(async () => {\n${body}\n})()`
}

// No clock finer than a second inside the sandbox.
const PRELUDE = `(() => {
  const D = Date, now = () => Math.floor(D.now() / 1000) * 1000;
  function C(...a) { return new.target ? (a.length ? new D(...a) : new D(now())) : new D(now()).toString() }
  C.prototype = D.prototype; C.now = now; C.parse = D.parse; C.UTC = D.UTC;
  Object.defineProperty(D.prototype, 'constructor', { value: C });
  globalThis.Date = C;
})();`

const fmt_log = (v: unknown) =>
  typeof v === 'string' ? v : (JSON.stringify(v) ?? String(v))

export const execute_code = async (
  code: string,
  opts: ExecuteOptions
): Promise<ExecuteResult> => {
  const limits = { ...DEFAULT_LIMITS, ...opts.limits }
  const commands = (await code_commands()).filter(c =>
    available(c, opts.access)
  )
  const QJ = await load_quickjs()
  const rt = QJ.newRuntime()
  rt.setMemoryLimit(limits.memory_bytes)
  rt.setMaxStackSize(limits.stack_bytes)
  let cpu_used = 0
  let cpu_start = 0
  rt.setInterruptHandler(
    () => cpu_used + (Date.now() - cpu_start) > limits.cpu_ms
  )
  const vm: QuickJSContext = rt.newContext()

  const logs: string[] = []
  let log_chars = 0
  const calls: CallRecord[] = []
  let untrusted = false
  let finished = false
  const deferreds = new Set<QuickJSDeferredPromise>()
  const running = new Set<Promise<unknown>>()
  let in_flight = 0
  const queue: (() => void)[] = []

  // Everything the VM runs goes through here, so its CPU time is counted.
  const step = <T>(fn: () => T): T => {
    cpu_start = Date.now()
    try {
      return fn()
    } finally {
      cpu_used += Date.now() - cpu_start
    }
  }
  const pump = () => {
    if (finished || !vm.alive) return
    step(() => {
      const r = rt.executePendingJobs()
      if (r.error) r.error.dispose()
    })
  }

  const json_parse = vm
    .getProp(vm.global, 'JSON')
    .consume(j => vm.getProp(j, 'parse'))
  const to_vm = (value: unknown): QuickJSHandle => {
    if (value === undefined) return vm.undefined
    const s = vm.newString(JSON.stringify(value))
    const r = vm.callFunction(json_parse, vm.undefined, s)
    s.dispose()
    return vm.unwrapResult(r)
  }

  const call = (c: CodeCommand, arg: QuickJSHandle | undefined) => {
    const name = `faable.${c.js.join('.')}`
    let plan: CallPlan
    try {
      if (calls.length >= limits.max_calls)
        throw new CallError(
          `more than ${limits.max_calls} faable calls in one execute: return what you have, or use a command that lists more at once (--all, --latest)`
        )
      plan = plan_call(c, arg ? vm.dump(arg) : undefined, opts.project)
      const no = refusal(c, class_of(c, plan.effect), opts.access)
      if (no) throw new CallError(no)
    } catch (e) {
      return {
        error: vm.newError({
          name: 'FaableError',
          message: `${name}: ${(e as Error).message}`
        })
      }
    }
    const record: CallRecord = { command: c.path, ok: false, ms: 0 }
    calls.push(record)
    if (c.untrusted) untrusted = true
    const deferred = vm.newPromise()
    deferreds.add(deferred)
    const started = Date.now()
    const job = (async () => {
      if (in_flight >= limits.max_in_flight)
        await new Promise<void>(r => queue.push(r))
      in_flight++
      let result: CliResult
      try {
        result = await opts.run(plan.argv, {
          input: plan.stdin,
          timeout_ms: plan.timeout_ms,
          client: 'faable-mcp-code'
        })
      } catch (e) {
        result = { ok: false, error: { message: (e as Error).message } }
      } finally {
        in_flight--
        queue.shift()?.()
      }
      record.ms = Date.now() - started
      record.ok = result.ok
      if (result.ok === false) record.error = (result as any).error?.code
      if (finished || !deferred.alive) return
      if (result.ok) {
        const h = to_vm((result as { data: unknown }).data)
        deferred.resolve(h)
        if (h !== vm.undefined) h.dispose()
      } else {
        const e = (result as { error: CliError }).error
        const err = vm.newError({
          name: 'FaableError',
          message: `${name}: ${opts.error_text(e)}`
        })
        if (e.code)
          vm.newString(e.code).consume(h => vm.setProp(err, 'code', h))
        deferred.reject(err)
        err.dispose()
      }
      deferreds.delete(deferred)
      deferred.dispose()
      pump()
    })()
    running.add(job)
    job.finally(() => running.delete(job))
    return deferred.handle
  }

  const cleanup = () => {
    finished = true
    for (const d of deferreds) d.dispose()
    deferreds.clear()
    json_parse.dispose()
    vm.dispose()
    rt.dispose()
  }

  try {
    // console.log / .error / .warn: kept, up to a cap, for the answer.
    const consoleh = vm.newObject()
    for (const level of ['log', 'info', 'warn', 'error']) {
      vm.newFunction(level, (...args) => {
        const line = args.map(a => fmt_log(vm.dump(a))).join(' ')
        if (log_chars < limits.max_log_chars) {
          logs.push(line.slice(0, limits.max_log_chars - log_chars))
          log_chars += line.length
        }
      }).consume(f => vm.setProp(consoleh, level, f))
    }
    vm.setProp(vm.global, 'console', consoleh)
    consoleh.dispose()

    // faable.deploy.apps.list(…), one function per command.
    const root = vm.newObject()
    const groups = new Map<string, QuickJSHandle>([['', root]])
    for (const c of commands) {
      let parent = root
      for (let i = 0; i < c.js.length - 1; i++) {
        const key = c.js.slice(0, i + 1).join('.')
        let g = groups.get(key)
        if (!g) {
          g = vm.newObject()
          vm.setProp(parent, c.js[i], g)
          groups.set(key, g)
        }
        parent = g
      }
      vm.newFunction(c.js[c.js.length - 1], (a?: QuickJSHandle) =>
        call(c, a)
      ).consume(f => vm.setProp(parent, c.js[c.js.length - 1], f))
    }
    vm.setProp(vm.global, 'faable', root)
    for (const g of groups.values()) g.dispose()

    step(() => vm.unwrapResult(vm.evalCode(PRELUDE)).dispose())

    const evaluated = step(() => vm.evalCode(wrap_code(code), 'execute.js'))
    if (evaluated.error) {
      const e = vm.dump(evaluated.error)
      evaluated.error.dispose()
      return {
        ok: false,
        error: describe_error(e, cpu_used, limits),
        logs,
        calls,
        untrusted
      }
    }
    const promise = (evaluated as { value: QuickJSHandle }).value
    const settled = vm.resolvePromise(promise)
    promise.dispose()
    pump()

    const deadline = Date.now() + limits.wall_ms
    let timer: ReturnType<typeof setTimeout> | undefined
    const outcome = await Promise.race([
      settled.then(r => ({ r })),
      new Promise<{ timeout: true }>(r => {
        timer = setTimeout(() => r({ timeout: true }), limits.wall_ms)
      })
    ])
    clearTimeout(timer)
    if ('timeout' in outcome) {
      return {
        ok: false,
        error: `execute took longer than ${Math.round(limits.wall_ms / 1000)} s and was stopped (the commands it started may still finish)`,
        logs,
        calls,
        untrusted
      }
    }
    // Calls the code started and did not await still finish — and are
    // reported — before the answer goes back.
    await Promise.race([
      Promise.allSettled([...running]),
      new Promise(r =>
        setTimeout(r, Math.max(0, deadline - Date.now())).unref()
      )
    ])
    const r = outcome.r
    if (r.error) {
      const e = vm.dump(r.error)
      r.error.dispose()
      return {
        ok: false,
        error: describe_error(e, cpu_used, limits),
        logs,
        calls,
        untrusted
      }
    }
    const handle = (r as { value: QuickJSHandle }).value
    const value = vm.dump(handle)
    handle.dispose()
    return { ok: true, value, logs, calls, untrusted }
  } finally {
    cleanup()
  }
}

const describe_error = (e: any, cpu_used: number, limits: ExecuteLimits) => {
  if (e && typeof e === 'object') {
    const msg = `${e.name ?? 'Error'}: ${e.message ?? JSON.stringify(e)}`
    if (/interrupted/i.test(msg) || cpu_used > limits.cpu_ms)
      return `the code ran for more than ${limits.cpu_ms / 1000} s of CPU and was stopped`
    return msg
  }
  return String(e)
}
