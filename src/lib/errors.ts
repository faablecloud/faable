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
  | 'apikey_invalid' // 401 with FAABLE_API_KEY: wrong or revoked key
  | 'forbidden' // 403
  | 'not_found' // 404
  | 'confirmation_required' // a prompt nobody can answer (no TTY, no --yes)
  | 'app_required' // the command needs --app and could not infer one
  | 'project_required' // several projects and none chosen: --project
  | 'name_taken' // creating an app with the name of one already in the project
  | 'operation_failed' // a queued operation (a volume backup, restore…) ended failed
  | 'usage' // bad invocation: unknown command, missing argument…
  | 'domain_taken' // 409, the api's code: the hostname is already registered
  | 'domain_unlinked' // 409, the api's code: already in this project, linked to no app

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
