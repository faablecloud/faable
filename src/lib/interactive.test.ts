import test from 'ava'
import { CliError, error_json } from './errors'
import { is_non_interactive } from './interactive'

test('non-interactive mode is opt-in: env or flag, never just a missing TTY', t => {
  t.false(is_non_interactive({}, ['node', 'faable', 'deploy']))
  t.true(is_non_interactive({ FAABLE_NONINTERACTIVE: '1' }, []))
  t.true(is_non_interactive({ FAABLE_NONINTERACTIVE: 'true' }, []))
  t.false(is_non_interactive({ FAABLE_NONINTERACTIVE: '0' }, []))
  t.true(is_non_interactive({}, ['node', 'faable', '--non-interactive']))
})

test('error_json carries code, status and action when there are any', t => {
  t.deepEqual(error_json(new CliError('not_logged_in', 'log in')), {
    error: { message: 'log in', code: 'not_logged_in' }
  })

  // A FaableApi error: the api's code and next step pass through.
  const api_error = Object.assign(new Error('FaableApi /app 409: linked'), {
    status: 409,
    code: 'repo_not_visible',
    action: 'install_github_app'
  })
  t.deepEqual(error_json(api_error), {
    error: {
      message: 'FaableApi /app 409: linked',
      code: 'repo_not_visible',
      status: 409,
      action: 'install_github_app'
    }
  })

  t.deepEqual(error_json(new Error('plain')), { error: { message: 'plain' } })
})
