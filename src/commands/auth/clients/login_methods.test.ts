import test from 'ava'
import {
  apply_login_method_changes,
  effective_login_methods,
  resolve_connection
} from './login_methods'

const connections = [
  { id: 'connection_otp', connection_name: 'OTP', connection_type: 'passwordless_email' },
  { id: 'connection_db', connection_name: 'Database', connection_type: 'database' },
  { id: 'connection_gh', connection_name: 'github', connection_type: 'github' },
  { id: 'connection_gl1', connection_name: 'gitlab', connection_type: 'gitlab' },
  { id: 'connection_gl2', connection_name: 'gitlab-login', connection_type: 'gitlab' }
]

test('nothing asked, nothing sent', t => {
  t.is(apply_login_method_changes({ order: ['x'] }, null, connections, {}), undefined)
})

test('only keeps exactly those and removes every other one', t => {
  const next = apply_login_method_changes(null, null, connections, {
    only: ['otp'],
    passkey: 'on'
  })
  t.deepEqual(next?.disabled_connections?.sort(), [
    'connection_db',
    'connection_gh',
    'connection_gl1',
    'connection_gl2'
  ])
  t.true(next?.passkey_login_enabled)
})

test("the first own list starts from what the tenant removes, not from nothing", t => {
  const next = apply_login_method_changes(
    null,
    { disabled_connections: ['connection_db'] },
    connections,
    { disable: ['github'] }
  )
  t.deepEqual(next?.disabled_connections?.sort(), ['connection_db', 'connection_gh'])
})

test('enable undoes a removal; untouched fields keep their value', t => {
  const next = apply_login_method_changes(
    { disabled_connections: ['connection_gh'], order: ['passkey'] },
    null,
    connections,
    { enable: ['connection_gh'] }
  )
  t.deepEqual(next, { disabled_connections: [], order: ['passkey'] })
})

test('passkey inherit drops the field; an empty override becomes null', t => {
  t.is(
    apply_login_method_changes({ passkey_login_enabled: true }, null, connections, {
      passkey: 'inherit'
    }),
    null
  )
  t.is(
    apply_login_method_changes({ order: ['x'] }, null, connections, { inherit: true }),
    null
  )
})

test('a connection by id or name; unknown and ambiguous names are refused', t => {
  t.is(resolve_connection(connections, 'connection_gh').id, 'connection_gh')
  t.is(resolve_connection(connections, 'GitHub').id, 'connection_gh')
  t.throws(() => resolve_connection(connections, 'google'), { message: /Unknown connection/ })
  t.throws(
    () =>
      resolve_connection(
        [...connections, { id: 'connection_otp2', connection_name: 'OTP' }],
        'OTP'
      ),
    { message: /use the id/ }
  )
})

test('the summary: passkey, the offered connections, no hidden OIDC', t => {
  const now = effective_login_methods(
    { disabled_connections: ['connection_db'], passkey_login_enabled: true },
    null,
    [
      ...connections.slice(0, 2),
      { id: 'connection_oidc', connection_name: 'corp', connection_type: 'oidc' },
      { id: 'connection_off', connection_name: 'off', connection_type: 'github', enabled: false }
    ]
  )
  t.true(now.passkey)
  t.deepEqual(now.connections.map(c => c.id), ['connection_otp'])
})
