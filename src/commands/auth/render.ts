// Pure rendering helpers for the `faable auth` read commands.

// JSON output and tables are the listing contract's (src/lib/listing.ts).
export { print_json, table_lines } from '../../lib/listing'

export const yes_no = (v?: boolean): string => (v ? '✓' : '-')

export const truncate = (s: string | undefined | null, max: number): string => {
  if (!s) return '-'
  const one_line = s.replace(/\s+/g, ' ').trim()
  return one_line.length > max ? one_line.slice(0, max - 1) + '…' : one_line
}

// Relative age, matching the deploy commands' `when` formatting.
export const when = (iso?: string | null): string => {
  if (!iso) return '-'
  const ms = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

const STATUS_ICONS: Record<string, string> = {
  success: '🟢',
  info: '🔵',
  skipped: '⚪',
  failed: '🔴'
}

export const log_status_badge = (status?: string): string => {
  const s = status || 'info'
  return `${STATUS_ICONS[s] ?? '⚪'} ${s}`
}
