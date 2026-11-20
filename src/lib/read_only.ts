import { CommandModule } from 'yargs'
import { walk } from './catalog'
import { effect_of } from './effects'
import { CliError } from './errors'

// Read-only mode: FAABLE_READONLY=1 or --read-only. Every command whose call
// would change Faable (effect `write` or `destructive`, src/lib/effects.ts)
// fails with `read_only` before it sends anything; reads and the machine's own
// state (login, project use) go through.
//
// It is what keeps an agent driving the CLI from a shell — with no MCP
// `--writes` in between — from changing anything the user did not mean it to
// (arch/deploy/cli-code-mode-plan.md, F3). The Faable skill turns it on; the
// user turns it off on purpose. A `faable mcp` started in it hands it to every
// CLI run of its tools, which inherit the environment.

const truthy = (v: string | undefined) =>
  v !== undefined && !['', '0', 'false', 'no'].includes(v.toLowerCase())

export const is_read_only = (argv: Record<string, any> = {}) =>
  argv['read-only'] === true || truthy(process.env.FAABLE_READONLY)

const GUARDED = Symbol('read_only_guarded')

const refuse = (path: string, effect: string) =>
  new CliError(
    'read_only',
    `\`faable ${path}\` ${effect === 'destructive' ? 'deletes or overwrites' : 'changes'} something in Faable, and the CLI is in read-only mode (FAABLE_READONLY / --read-only). Nothing was sent.`,
    {
      action:
        'Ask the user before running it; it runs once they unset FAABLE_READONLY'
    }
  )

// Wraps the handler of every command under `roots`, in place, with the check
// for its own canonical path — so an alias, a group's default command or a
// hidden one is covered like any other. A command missing from the effects
// table counts as a write: the guard fails closed.
export const guard_read_only = (roots: CommandModule<any, any>[]) => {
  for (const { path, module } of walk(roots)) {
    const mod = module as any
    if (mod[GUARDED] || typeof mod.handler !== 'function') continue
    const handler = mod.handler
    // async: a refusal has to reject, not throw — a synchronous throw from a
    // handler skips the global .fail() and dies as a Node stack trace.
    mod.handler = async (argv: Record<string, any>) => {
      if (is_read_only(argv)) {
        const effect = effect_of(path, argv) ?? 'write'
        if (effect === 'write' || effect === 'destructive')
          throw refuse(path, effect)
      }
      return handler(argv)
    }
    mod[GUARDED] = true
  }
  return roots
}
