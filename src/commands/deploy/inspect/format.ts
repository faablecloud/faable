import { AppLogLine, FaableApp, FaableDeployment } from '../../../api/FaableApi'

// Pure formatting helpers for the read commands (logs/status/list/
// deployments), kept out of the handlers for tests.

const PHASE_ICONS: Record<string, string> = {
  READY: '🟢',
  INITIALIZING: '🔵',
  BUILDING: '🔵',
  QUEUED: '⚪',
  UNKNOWN: '⚪',
  QUOTA_HOLD: '🟡',
  SUPERSEDED: '⚪',
  CANCELED: '⚪',
  TERMINATING: '⚪',
  ERROR: '🔴',
  BUILD_ERROR: '🔴'
}

export const phase_badge = (phase?: string | null): string => {
  const p = phase || 'UNKNOWN'
  return `${PHASE_ICONS[p] ?? '⚪'} ${p}`
}

// "python 3.11.3 (django)" from the platform-detected metadata; null when
// nothing was ever detected (no build yet).
export const detected_summary = (
  detected?: FaableApp['detected']
): string | null => {
  if (!detected) return null
  const runtime = [detected.runtime.name, detected.runtime.version]
    .filter(Boolean)
    .join(' ')
  return detected.framework ? `${runtime} (${detected.framework})` : runtime
}

// Loki serves [ns_timestamp, text, deployment_id] newest first; render
// oldest first (reading order) with an ISO second-precision prefix.
export const format_log_lines = (lines: AppLogLine[]): string[] =>
  [...lines]
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([ts, text]) => {
      const iso = new Date(Number(ts) / 1e6).toISOString().replace(/\.\d+Z$/, 'Z')
      return `${iso}  ${text.replace(/\n+$/, '')}`
    })

export const short_commit = (sha?: string): string =>
  sha ? sha.slice(0, 7) : '-'

export const when = (iso?: string): string => {
  if (!iso) return '-'
  const ms = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

// One row per deployment for the `deployments` table.
export const deployment_row = (d: FaableDeployment): string => {
  const release = d.release ? ` ${d.release}` : ''
  const trigger = d.trigger === 'webhook' ? 'push' : 'cli'
  return `${phase_badge(d.status?.phase)}  ${d.id}  ${short_commit(d.github_commit)}${release}  (${trigger}, ${when(d.createdAt)})`
}
