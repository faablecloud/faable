import test from 'ava'
import {
  detected_summary,
  deployment_row,
  format_log_lines,
  phase_badge,
  short_commit
} from './format'

test('phase_badge maps phases and defaults unknown', t => {
  t.is(phase_badge('READY'), '🟢 READY')
  t.is(phase_badge('BUILD_ERROR'), '🔴 BUILD_ERROR')
  t.is(phase_badge(undefined), '⚪ UNKNOWN')
  t.is(phase_badge('SOMETHING_NEW'), '⚪ SOMETHING_NEW')
})

test('detected_summary renders runtime and framework', t => {
  t.is(
    detected_summary({
      buildpack: 'python',
      framework: 'django',
      runtime: { name: 'python', version: '3.11.3' }
    }),
    'python 3.11.3 (django)'
  )
  t.is(
    detected_summary({ buildpack: 'node', runtime: { name: 'node' } }),
    'node'
  )
  t.is(detected_summary(null), null)
  t.is(detected_summary(undefined), null)
})

test('format_log_lines sorts oldest-first and stamps ISO seconds', t => {
  // Loki ns timestamps, newest first as the API serves them.
  const lines = format_log_lines([
    ['1767225660000000000', 'second line\n', 'deployment_b'],
    ['1767225600000000000', 'first line', 'deployment_a']
  ])
  t.is(lines.length, 2)
  t.true(lines[0].endsWith('first line'))
  t.true(lines[1].endsWith('second line'))
  t.regex(lines[0], /^2026-01-01T00:00:00Z {2}/)
})

test('deployment_row is compact and phase-first', t => {
  const row = deployment_row({
    id: 'deployment_1',
    status: { phase: 'READY' },
    github_commit: 'abcdef1234567890',
    release: '1.2.0',
    trigger: 'webhook',
    createdAt: new Date(Date.now() - 3 * 60_000).toISOString()
  })
  t.is(row, '🟢 READY  deployment_1  abcdef1 1.2.0  (push, 3m ago)')
})

test('short_commit truncates and dashes when absent', t => {
  t.is(short_commit('abcdef1234'), 'abcdef1')
  t.is(short_commit(undefined), '-')
})
