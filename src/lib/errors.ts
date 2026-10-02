// The closed vocabulary of failures a program driving this CLI (a script, the
// Faable MCP server) can branch on without parsing prose. With --json — or in
// non-interactive mode — the global .fail() in src/index.ts prints every
// error as {"error":{"message","code","status","action"}} on stderr.
//
// A `code` from the Faable API's error body passes through untouched; these
// are the ones the CLI itself decides.
export type CliErrorCode =
  | 'not_logged_in' // no credentials at all → `faable login`
  | 'session_expired' // 401: the session is dead → `faable login`
  | 'account_suspended' // the auth server refuses this account
  | 'apikey_session' // logged in with an API key where a session is needed
  | 'forbidden' // 403
  | 'not_found' // 404
  | 'confirmation_required' // a prompt nobody can answer (no TTY, no --yes)
  | 'app_required' // the command needs --app and could not infer one
  | 'project_required' // several projects and none chosen: --project
  | 'usage' // bad invocation: unknown command, missing argument…

export interface CliErrorFields {
  code?: string
  status?: number
  action?: string
}

export class CliError extends Error {
  code: string
  status?: number
  action?: string

  constructor(
    code: CliErrorCode,
    message: string,
    extra: { status?: number; action?: string; cause?: unknown } = {}
  ) {
    super(
      message,
      extra.cause === undefined ? undefined : { cause: extra.cause }
    )
    this.name = 'CliError'
    this.code = code
    if (extra.status !== undefined) this.status = extra.status
    if (extra.action !== undefined) this.action = extra.action
  }
}

// The JSON body of a failure, from any error: a CliError, a FaableApi error
// (which carries status/code/action) or a plain Error.
export const error_json = (err: unknown) => {
  const e = (err ?? {}) as Error & CliErrorFields
  const message = e.message || String(err)
  return {
    error: {
      message,
      ...(e.code ? { code: e.code } : {}),
      ...(e.status ? { status: e.status } : {}),
      ...(e.action ? { action: e.action } : {})
    }
  }
}

export const NOT_LOGGED_IN = "Not logged in. Run 'faable login' first."
