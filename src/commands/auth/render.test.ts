import test from 'ava'
import { log_status_badge, table_lines, truncate, yes_no } from './render'

test('table_lines pads columns to the widest cell', t => {
  const lines = table_lines(
    ['ID', 'NAME'],
    [
      ['user_1', 'a'],
      ['user_22', 'bb']
    ]
  )
  t.deepEqual(lines, ['ID       NAME', 'user_1   a', 'user_22  bb'])
})

test('table_lines does not pad the last column (no trailing spaces)', t => {
  const lines = table_lines(['A', 'B'], [['x', 'y']])
  for (const line of lines) t.is(line, line.trimEnd())
})

test('table_lines tolerates missing cells', t => {
  const lines = table_lines(['A', 'B'], [['only']])
  t.is(lines[1], 'only')
})

test('truncate collapses whitespace and appends an ellipsis', t => {
  t.is(truncate('hello   world\nagain', 100), 'hello world again')
  t.is(truncate('abcdef', 5), 'abcd…')
  t.is(truncate(undefined, 5), '-')
  t.is(truncate(null, 5), '-')
})

test('yes_no renders check or dash', t => {
  t.is(yes_no(true), '✓')
  t.is(yes_no(false), '-')
  t.is(yes_no(undefined), '-')
})

test('log_status_badge maps statuses and defaults unknowns', t => {
  t.is(log_status_badge('success'), '🟢 success')
  t.is(log_status_badge('failed'), '🔴 failed')
  t.is(log_status_badge(undefined), '🔵 info')
  t.is(log_status_badge('weird'), '⚪ weird')
})
