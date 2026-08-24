import {
  FaableApp,
  FaableArtifact,
  FaableDeployment
} from '../../../api/FaableApi'
import { detected_summary, phase_badge, short_commit, when } from './format'

// Pure rendering of `faable deploy inspect` — everything the platform
// recorded about ONE deployment, in reading order. Kept out of the handler
// so the layout is testable without an API.

export const format_bytes = (bytes?: number): string => {
  if (!bytes || bytes < 0) return '-'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`
}

// "refs/heads/main" → "main"; a bare branch name passes through.
export const short_ref = (ref?: string): string | null =>
  ref ? ref.replace(/^refs\/(heads|tags)\//, '') : null

// "next-standalone · node 22 · 41.2 MB" from the deploy-v3 runnable
// descriptor; null while the build has not sealed one yet.
export const artifact_summary = (
  artifact?: FaableArtifact | null
): string | null => {
  const a = artifact?.artifact
  if (!a) return null
  const runtime = [a.runtime.name, a.runtime.version].filter(Boolean).join(' ')
  return [a.profile, runtime, format_bytes(a.size)].filter(Boolean).join(' · ')
}

// First line of a commit message (the subject), quoted.
const commit_subject = (message?: string): string | null => {
  const subject = message?.split('\n')[0].trim()
  return subject ? `"${subject}"` : null
}

const label = (name: string, value: string): string =>
  `  ${`${name}:`.padEnd(12)}${value}`

// Command suggestions that match the phase: what you would actually run next,
// rendered as labeled lines so they stay in the same column as the record.
// A BUILD_ERROR never ran, so it has no runtime logs to offer; a retired
// deployment does (for 24h — the runtime window), plus its frozen build output.
const next_steps = (d: FaableDeployment, is_live: boolean): string[] => {
  const phase = d.status?.phase ?? ''
  const runtime = label('Logs', `faable deploy logs -d ${d.id}`)
  const build = label('Build', `faable deploy logs --build -d ${d.id}`)
  const retry = label('Retry', `faable deploy redeploy ${d.id}`)

  if (phase === 'BUILD_ERROR') return [build, retry]
  if (phase === 'ERROR') return [runtime, build, retry]
  if (phase === 'BUILDING' || phase === 'QUEUED' || phase === 'UNKNOWN') {
    return [label('Follow', `faable deploy logs --build -d ${d.id} --follow`)]
  }
  if (is_live) return [label('Logs', 'faable deploy logs')]
  return [runtime, build]
}

export const deployment_detail = (args: {
  app: FaableApp
  deployment: FaableDeployment
  artifact?: FaableArtifact | null
}): string[] => {
  const { app, deployment: d, artifact } = args
  const is_live = d.id === app.status?.deployment
  const lines: string[] = []

  lines.push(`${phase_badge(d.status?.phase)}  ${d.id}`)
  lines.push(label('App', `${app.name} (${app.id})`))
  if (d.createdAt) {
    lines.push(label('Created', `${when(d.createdAt)} (${d.createdAt})`))
  }
  lines.push(
    label('Trigger', d.trigger === 'webhook' ? 'push (webhook)' : 'cli')
  )
  lines.push(
    label('Serving', is_live ? `yes — https://${app.url}` : 'no (not live)')
  )

  if (d.github_commit) {
    const attribution = [
      short_ref(d.github_ref),
      d.github_actor && `by ${d.github_actor}`
    ]
      .filter(Boolean)
      .join(' ')
    const commit = [
      short_commit(d.github_commit),
      commit_subject(d.github_commit_message),
      attribution && `(${attribution})`
    ]
      .filter(Boolean)
      .join(' ')
    lines.push(label('Commit', commit))
  }
  if (d.release) lines.push(label('Release', d.release))

  // Stack the builder detected for THIS build (falls back to the app's, which
  // is the last successful detection).
  const stack = detected_summary(d.detected ?? app.detected)
  if (stack) lines.push(label('Stack', stack))

  const runnable = artifact_summary(artifact)
  if (runnable) {
    const ready = d.artifact_ready_at
      ? ` (sealed ${when(d.artifact_ready_at)})`
      : ''
    lines.push(label('Artifact', `${runnable}${ready}`))
  }
  if (artifact?.artifact?.start_command) {
    lines.push(label('Start', artifact.artifact.start_command))
  }
  if (artifact?.purged_at) {
    lines.push(
      label('Purged', `${when(artifact.purged_at)} — source no longer stored`)
    )
  }
  if (d.image) lines.push(label('Image', d.image))
  if (d.status?.runtime_image) {
    lines.push(label('Runtime', d.status.runtime_image))
  }
  if (d.redeploy_of) lines.push(label('Rebuild of', d.redeploy_of))
  if (d.quota_released_at) {
    lines.push(label('Quota', `hold released ${when(d.quota_released_at)}`))
  }

  if (d.status?.reason) {
    lines.push('  Reason:')
    for (const line of d.status.reason.split('\n')) {
      lines.push(`    ${line}`)
    }
  }

  lines.push(...next_steps(d, is_live))
  return lines
}
