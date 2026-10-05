// Pure helpers to compose FaableQL filter strings from CLI flags.
//
// FaableQL grammar (server-side, @faablecloud/faableql): space-separated
// `field:value` terms, ANDed; values only allow [alnum _ - @ .], so a `:`
// inside a value (e.g. an ISO-8601 timestamp) is a parse error — dates must be
// unix-millis or YYYY-MM-DD.

// Join flag-derived terms with a user-provided --query passthrough.
export const compose_query = (
  terms: Array<string | undefined | false>,
  passthrough?: string
): string | undefined => {
  const parts = terms.filter((t): t is string => !!t)
  if (passthrough?.trim()) parts.push(passthrough.trim())
  return parts.length ? parts.join(' ') : undefined
}

// Build a single `field:value` term, refusing values FaableQL cannot parse
// (anything outside [alnum _ - @ .]) with a readable error instead of a
// server-side 400.
export const term = (field: string, value?: string): string | undefined => {
  if (value === undefined || value === '') return undefined
  if (!/^[a-zA-Z0-9_\-@.]+$/.test(value)) {
    throw new Error(
      `Invalid value for --${field}: "${value}" (allowed: letters, digits, _ - @ .)`
    )
  }
  return `${field}:${value}`
}

// Validate a --since/--until value: unix-millis or YYYY-MM-DD. ISO timestamps
// carry ':' which FaableQL rejects, so we fail fast with the fix.
export const time_term = (
  field: 'since' | 'until',
  value?: string
): string | undefined => {
  if (value === undefined || value === '') return undefined
  if (!/^\d+$/.test(value) && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(
      `Invalid --${field}: "${value}". Use unix-millis or YYYY-MM-DD (ISO timestamps with ':' are not supported)`
    )
  }
  return `${field}:${value}`
}

// A point in time for a range flag: a relative age (`30m`, `24h`, `7d` — that
// long ago), unix-millis, or YYYY-MM-DD. Returned as what FaableQL accepts:
// unix-millis or the date as given.
export const time_value = (
  flag: string,
  value: string,
  now: number = Date.now()
): string => {
  const rel = /^(\d+)([mhd])$/.exec(value)
  if (rel) {
    const unit = { m: 60_000, h: 3_600_000, d: 86_400_000 }[
      rel[2] as 'm' | 'h' | 'd'
    ]
    return String(now - Number(rel[1]) * unit)
  }
  if (/^\d+$/.test(value) || /^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  throw new Error(
    `Invalid --${flag}: "${value}". Use a relative age (30m, 24h, 7d), unix-millis or YYYY-MM-DD`
  )
}

// `<field>:<time>` for a range field of the server (`last_login_since`,
// `since`…), from a flag that takes a time_value.
export const range_term = (
  field: string,
  flag: string,
  value?: string,
  now?: number
): string | undefined =>
  value === undefined || value === ''
    ? undefined
    : `${field}:${time_value(flag, value, now)}`
