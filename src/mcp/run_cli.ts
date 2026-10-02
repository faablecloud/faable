import { spawn } from 'node:child_process'
import os from 'node:os'

// Every MCP tool is one run of this same CLI (arch/deploy/mcp-server-faable.md,
// Fase 1 — the contract in arch/deploy/mcp-cli-gaps.md):
//
//  - M1: it runs ITSELF — this node, these exec flags, this entry script —
//    never whatever `faable` is on the PATH, which can be another version;
//  - M2: always --json, FAABLE_NONINTERACTIVE=1 (no prompt, no app guessed
//    from the working directory, errors as JSON) and FAABLE_CLIENT_NAME so
//    the api counts this traffic as `faable-mcp`;
//  - M3: from a neutral directory, so no faable.json or git remote of
//    wherever the MCP client was started decides anything.

export interface CliError {
  message: string
  code?: string
  status?: number
  action?: string
}

export type CliResult =
  { ok: true; data: unknown } | { ok: false; error: CliError }

export interface RunOptions {
  // Written to the child's stdin (secrets travel here, never in argv).
  input?: string
  timeout_ms?: number
  // Tests point these elsewhere; by default, the running CLI itself.
  entry?: string
  env?: Record<string, string | undefined>
}

const DEFAULT_TIMEOUT_MS = 120_000

// The child runs from the temp dir (M3), where a bare `--import tsx` (how the
// tests and `npm run cli` start this CLI) would no longer resolve. Resolve
// such loaders here, from the CLI's own location, before handing them on.
export const portable_exec_argv = (
  exec_argv: string[] = process.execArgv,
  resolve: (spec: string) => string = spec => import.meta.resolve(spec)
): string[] => {
  const bare = (spec: string) => !/^(\.|\/|file:|node:|data:)/.test(spec)
  return exec_argv.map((arg, i) => {
    if (exec_argv[i - 1] === '--import' && bare(arg)) return resolve(arg)
    const inline = /^--import=(.+)$/.exec(arg)
    if (inline && bare(inline[1])) return `--import=${resolve(inline[1])}`
    return arg
  })
}

// The last JSON line on stderr is the error document; anything before it is
// the CLI's own log lines.
const parse_error = (stderr: string, code: number | null): CliError => {
  const lines = stderr.trim().split('\n').reverse()
  for (const line of lines) {
    try {
      const doc = JSON.parse(line) as { error?: CliError }
      if (doc.error?.message) return doc.error
    } catch {
      // not JSON: a log line
    }
  }
  return {
    message:
      stderr.trim().split('\n').slice(-5).join('\n') ||
      `faable exited with ${code}`
  }
}

export const run_cli = (
  args: string[],
  opts: RunOptions = {}
): Promise<CliResult> =>
  new Promise(resolve => {
    const entry = opts.entry ?? process.argv[1]
    const child = spawn(
      process.execPath,
      [...portable_exec_argv(), entry, ...args, '--json'],
      {
        cwd: os.tmpdir(),
        env: {
          ...(opts.env ?? process.env),
          FAABLE_NONINTERACTIVE: '1',
          FAABLE_CLIENT_NAME: 'faable-mcp',
          NO_COLOR: '1'
        },
        stdio: ['pipe', 'pipe', 'pipe']
      }
    )
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => (stdout += chunk))
    child.stderr.on('data', chunk => (stderr += chunk))
    child.stdin.end(opts.input ?? '')

    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      resolve({
        ok: false,
        error: {
          message: 'faable took too long to answer and was stopped',
          code: 'timeout'
        }
      })
    }, opts.timeout_ms ?? DEFAULT_TIMEOUT_MS)

    child.on('error', err => {
      clearTimeout(timer)
      resolve({
        ok: false,
        error: { message: err.message, code: 'spawn_failed' }
      })
    })
    child.on('close', code => {
      clearTimeout(timer)
      if (code !== 0)
        return resolve({ ok: false, error: parse_error(stderr, code) })
      try {
        resolve({ ok: true, data: JSON.parse(stdout) })
      } catch {
        resolve({
          ok: false,
          error: {
            message: `faable printed something that is not JSON: ${stdout.slice(0, 200)}`
          }
        })
      }
    })
  })
