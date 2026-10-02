import prompts from 'prompts'
import { CliError } from './errors'

// Non-interactive mode: FAABLE_NONINTERACTIVE=1 or the global
// --non-interactive flag. A program drives the CLI (the Faable MCP server sets
// it on every call), so:
//
//   - no prompt is ever shown: a confirmation without --yes is an error
//     (`confirmation_required`), never a silent "Cancelled." with exit 0;
//   - nothing is inferred from the working directory: the app comes from
//     --app, never from faable.json or the git remote of wherever the process
//     happens to run (see find_app_id);
//   - `deploy launch` needs --yes, --app and --workdir spelled out;
//   - errors are JSON on stderr, as with --json.
//
// Opt-in rather than "no TTY": CI runs without one and `faable deploy` there
// must keep deploying unattended.
export const is_non_interactive = (
  env: Record<string, string | undefined> = process.env,
  argv: string[] = process.argv
): boolean =>
  ['1', 'true'].includes((env.FAABLE_NONINTERACTIVE ?? '').toLowerCase()) ||
  argv.includes('--non-interactive')

// Ask before something destructive. True to go ahead, false when the person
// said no. Throws `confirmation_required` when nobody can answer: in
// non-interactive mode, or when stdin/stderr are not a terminal (prompts
// would otherwise resolve undefined and the command would report a
// cancellation as a clean exit 0 that a caller reads as success).
//
// The prompt is drawn on stderr: stdout carries data only.
export const confirm = async (opts: {
  message: string
  yes?: boolean
}): Promise<boolean> => {
  if (opts.yes) return true
  if (is_non_interactive() || !process.stdin.isTTY || !process.stderr.isTTY) {
    throw new CliError(
      'confirmation_required',
      `${opts.message} — confirmation needed: pass --yes.`
    )
  }
  const { confirm } = await prompts(
    {
      type: 'toggle',
      name: 'confirm',
      message: opts.message,
      initial: false,
      active: 'yes',
      inactive: 'no',
      stdout: process.stderr
    },
    { onCancel: () => false }
  )
  return !!confirm
}
