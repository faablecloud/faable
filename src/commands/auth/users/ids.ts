// Resolve the target user ids for a bulk operation. Ids come from argv, from
// stdin when none are given and input is piped (`… list --json | jq -r … |
// faable auth users suspend`), or from a '-' placeholder. NB: yargs drops a
// bare '-' from positionals, so piping with NO ids is the supported spelling;
// '-' is still honored if it survives parsing. Dedupes, keeps order, and
// rejects anything that doesn't look like a user id BEFORE any mutation runs.
export const wants_stdin = (args: string[], is_tty: boolean): boolean =>
  args.includes('-') || (args.length === 0 && !is_tty)

export const parse_user_ids = (
  args: string[],
  stdin: string | null
): string[] => {
  const stdin_tokens = stdin === null ? null : stdin.split(/\s+/).filter(Boolean)
  const raw: string[] = []
  let stdin_used = false
  for (const a of args) {
    if (a === '-') {
      if (stdin_tokens === null) {
        throw new Error(
          "'-' requires ids on stdin (one or more, whitespace-separated)"
        )
      }
      raw.push(...stdin_tokens)
      stdin_used = true
    } else {
      raw.push(a)
    }
  }
  if (stdin_tokens !== null && !stdin_used) {
    raw.push(...stdin_tokens)
  }
  const ids = [...new Set(raw)]
  if (ids.length === 0) {
    throw new Error('No user ids given (pass ids, or pipe them via stdin)')
  }
  const invalid = ids.filter(id => !/^user_[a-zA-Z0-9]+$/.test(id))
  if (invalid.length > 0) {
    throw new Error(`Invalid user id(s): ${invalid.join(', ')} (expected user_…)`)
  }
  return ids
}

export const read_stdin = async (): Promise<string> => {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf8')
}
