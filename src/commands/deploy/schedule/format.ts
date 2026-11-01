import type { FaableTaskSchedule } from '../../../api/FaableApi'

// Why the last due run did not start, in the user's words. Matches the api's
// `skip_reason` (deploy/task/TaskSchedule.model.ts).
const SKIP: Record<NonNullable<FaableTaskSchedule['skip_reason']>, string> = {
  plan_required:
    'paused — the project is not on Hobby or Pro (resumes when it is)',
  previous_running: 'skipped — the previous run was still going',
  app_unavailable: 'skipped — the app has no live deployment',
  enqueue_failed: 'skipped — the task could not be queued'
}

export const format_schedule = (s: FaableTaskSchedule): string[] => {
  const lines = [
    `${s.enabled ? '●' : '○'} ${s.id}${s.name ? `  ${s.name}` : ''}`,
    `    ${s.cron} (UTC)  →  ${s.argv.join(' ')}`
  ]
  if (!s.enabled) lines.push('    off')
  else if (s.next_run_at) lines.push(`    next run ${s.next_run_at}`)
  else lines.push('    never runs again')
  if (s.last_run_at)
    lines.push(`    last run ${s.last_run_at} (${s.last_task_id ?? '—'})`)
  if (s.skip_reason) lines.push(`    ${SKIP[s.skip_reason] ?? s.skip_reason}`)
  return lines
}
