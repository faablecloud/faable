import test from 'ava'
import { log_entries, tail_lines } from './format'

test('log_entries: oldest first, ISO time, stream only when known', t => {
  const entries = log_entries([
    ['1700000001000000000', 'second\n', 'stderr'],
    ['1700000000000000000', 'first']
  ])
  t.deepEqual(entries, [
    { time: '2023-11-14T22:13:20.000Z', message: 'first' },
    { time: '2023-11-14T22:13:21.000Z', message: 'second', stream: 'stderr' }
  ])
})

test('tail_lines keeps the end, where a build failure says why', t => {
  const log = 'a\nb\nc\nd\n'
  t.deepEqual(tail_lines(log, 2), { content: 'c\nd\n', omitted_lines: 2 })
  t.deepEqual(tail_lines(log, 10), { content: log, omitted_lines: 0 })
  t.deepEqual(tail_lines(log), { content: log, omitted_lines: 0 })
  t.deepEqual(tail_lines('x\ny', 1), { content: 'y\n', omitted_lines: 1 })
})
