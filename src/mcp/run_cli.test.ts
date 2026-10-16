import test from 'ava'
import { parse_output } from './run_cli'

const doc = { app_id: 'app_new', outcome: 'live' }

test('stdout that is the document parses as it is', t => {
  t.deepEqual(parse_output(JSON.stringify(doc, null, 2)), { ok: true, data: doc })
})

// The deploy_directory case of 16-10: build log lines before the outcome.
// The deploy was live; the tool must say so, not "not JSON".
test('the document after stray lines is still the result', t => {
  const stdout = [
    'INFO faable-detector 0.0.0-development · deployment deployment_6ad229ef',
    'INFO Assembled 73 files into /workspace/context',
    JSON.stringify(doc, null, 2)
  ].join('\n')
  t.deepEqual(parse_output(stdout), { ok: true, data: doc })
})

test('no document at all is still a failure', t => {
  t.deepEqual(parse_output('INFO only a log line\n'), { ok: false })
  t.deepEqual(parse_output(''), { ok: false })
})
