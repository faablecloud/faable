import { posix } from 'node:path'
import type { FaableApi, FaableVolume, FaableVolumeOperation } from '../../../api/FaableApi'
import { CliError } from '../../../lib/errors'

// The pure half of the volumes commands (no api context): waiting for an
// operation, formatting, and where an import lands. Tested on its own.

const DONE = new Set(['completed', 'failed'])
const POLL_MS = 3000

/**
 * Polls an operation until it is completed or failed. A restore or an import
 * waits in `queued` while the backup that goes first (after_id) runs.
 */
export const wait_operation = async (
  api: FaableApi,
  team: string,
  op: FaableVolumeOperation,
  opts: {
    sleep?: (ms: number) => Promise<void>
    onState?: (s: FaableVolumeOperation['state']) => void
  } = {}
): Promise<FaableVolumeOperation> => {
  const sleep = opts.sleep ?? (ms => new Promise(r => setTimeout(r, ms)))
  let current = op
  let last = ''
  for (;;) {
    if (current.state !== last) opts.onState?.(current.state)
    last = current.state
    if (DONE.has(current.state)) return current
    await sleep(POLL_MS)
    current = await api.getVolumeOperation(team, op.id)
  }
}

/** Fails the command (exit 1) when the operation did. */
export const require_completed = (op: FaableVolumeOperation) => {
  if (op.state !== 'completed') {
    throw new CliError(
      'operation_failed',
      `The ${op.kind} ${op.id} failed: ${op.error ?? 'no reason given'}`
    )
  }
  return op
}

export const format_bytes = (n: number | null | undefined): string => {
  if (n == null) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = n
  let i = 0
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000
    i++
  }
  return `${i === 0 ? v : v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`
}

/** `1.2 GB of 10 GB (12%)` — the measured usage against the plan quota. */
export const format_usage = (v: FaableVolume): string => {
  if (v.used_bytes == null) return `not measured yet, quota ${v.quota_gb} GB`
  const pct = Math.round((v.used_bytes / (v.quota_gb * 1e9)) * 100)
  return `${format_bytes(v.used_bytes)} of ${v.quota_gb} GB (${pct}%)`
}

export const state_label: Record<FaableVolumeOperation['state'], string> = {
  awaiting_upload: '… waiting for the upload',
  queued: '… queued',
  running: '… running',
  completed: 'completed',
  failed: 'failed'
}

/**
 * Where, inside the volume, the files land: a relative path that stays inside
 * it. `.` (the default) is the volume's root.
 */
export const volume_dest = (to: string | undefined): string => {
  const raw = (to ?? '.').replace(/\\/g, '/').replace(/^\.\/+/, '')
  if (raw === '' || raw === '.') return '.'
  if (raw.startsWith('/')) {
    throw new CliError(
      'usage',
      `--to is a path inside the volume, relative to its root (wp-content/mu-plugins), not ${to}`
    )
  }
  const norm = posix.normalize(raw).replace(/\/+$/, '')
  if (norm === '..' || norm.startsWith('../')) {
    throw new CliError('usage', `--to ${to} leaves the volume`)
  }
  return norm === '' ? '.' : norm
}

export const is_archive = (p: string) => /\.(tar\.gz|tgz)$/i.test(p)
