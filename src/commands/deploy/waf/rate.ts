const UNITS: Record<string, '1s' | '1m'> = {
  s: '1s',
  sec: '1s',
  second: '1s',
  seconds: '1s',
  m: '1m',
  min: '1m',
  minute: '1m',
  minutes: '1m'
}
const LONG_UNITS = new Set(['h', 'hr', 'hour', 'hours', 'd', 'day', 'days'])

/**
 * `10/m` → `{ average: 10, period: '1m' }`.
 *
 * Per second and per minute only, and an hour is refused with the reason
 * rather than as an unknown unit: the edge refills its counters several times
 * an hour, so an hourly limit would not hold (the api says the same).
 */
export const parse_rate = (
  raw: string
): { average: number; period: '1s' | '1m' } => {
  const m = /^\s*(\d+)\s*\/\s*([a-z]+)\s*$/i.exec(String(raw))
  if (!m) {
    throw new Error(
      `Can't read --rate "${raw}". Use requests/unit, e.g. --rate 10/m (10 per minute) or --rate 5/s.`
    )
  }
  const average = Number(m[1])
  const unit = m[2].toLowerCase()
  if (LONG_UNITS.has(unit)) {
    throw new Error(
      'A limit counts per second or per minute, not per hour or day: the edge ' +
        'refills its counters several times an hour, so it would not hold.\n' +
        '  Use a per-minute rate, e.g. --rate 2/m instead of 100/h.'
    )
  }
  const period = UNITS[unit]
  if (!period) {
    throw new Error(
      `Unknown unit "${m[2]}" in --rate. Use /s (per second) or /m (per minute).`
    )
  }
  if (average < 1 || average > 10000) {
    throw new Error('--rate must be between 1 and 10000 requests per unit.')
  }
  return { average, period }
}
