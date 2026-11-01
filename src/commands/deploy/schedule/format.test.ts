import test from 'ava'
import { format_schedule } from './format'

const base = {
  id: 'taskschedule_1',
  app_id: 'app_1',
  name: 'followups',
  cron: '*/15 * * * *',
  argv: ['node', 'followups.js'],
  timeout_s: 900,
  enabled: true,
  next_run_at: '2026-11-01T10:15:00.000Z',
  last_run_at: null,
  last_task_id: null,
  skip_reason: null,
  skipped_at: null
}

test('an enabled schedule shows its expression, command and next run', t => {
  t.deepEqual(format_schedule(base), [
    '● taskschedule_1  followups',
    '    */15 * * * * (UTC)  →  node followups.js',
    '    next run 2026-11-01T10:15:00.000Z'
  ])
})

test('a schedule paused by the plan says so and how it comes back', t => {
  const lines = format_schedule({ ...base, skip_reason: 'plan_required' })
  t.regex(lines.at(-1)!, /Hobby or Pro \(resumes when it is\)/)
})

test('an off schedule shows no next run', t => {
  const lines = format_schedule({ ...base, enabled: false })
  t.true(lines.includes('    off'))
  t.false(lines.some(l => l.includes('next run')))
})
