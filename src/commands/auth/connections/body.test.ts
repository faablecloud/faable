import test from 'ava'
import { clean_secret, connection_create_body, public_connection } from './body'

test('passwordless_email: name, type and on by default — nothing else', t => {
  t.deepEqual(
    connection_create_body({ name: 'email', type: 'passwordless_email' }),
    {
      connection_name: 'email',
      connection_type: 'passwordless_email',
      enabled: true
    }
  )
})

test('--no-enabled creates it off', t => {
  t.is(
    connection_create_body({ name: 'db', type: 'database', enabled: false })
      .enabled,
    false
  )
})

test('a social provider sends only the provider fields given', t => {
  t.deepEqual(
    connection_create_body({
      name: 'okta',
      type: 'oidc',
      clientId: 'abc',
      clientSecret: 's3cr3t',
      issuer: 'https://acme.okta.com',
      scope: ['openid', 'email'],
      disableSignup: true
    }),
    {
      connection_name: 'okta',
      connection_type: 'oidc',
      enabled: true,
      client_id: 'abc',
      client_secret: 's3cr3t',
      issuer: 'https://acme.okta.com',
      scope: ['openid', 'email'],
      disable_signup: true
    }
  )
  // Google without a client id: Faable's shared app, no credentials sent.
  t.false(
    'client_id' in
      connection_create_body({ name: 'google', type: 'google_oauth2' })
  )
})

test('email codes and passwords refuse provider credentials', t => {
  const err = t.throws(() =>
    connection_create_body({
      name: 'email',
      type: 'passwordless_email',
      clientId: 'abc'
    })
  )
  t.regex(err!.message, /--client-id/)
  t.throws(() =>
    connection_create_body({ name: 'db', type: 'database', scope: ['x'] })
  )
})

test('the client secret never comes back, not even in JSON', t => {
  t.deepEqual(
    public_connection({
      id: 'connection_1',
      client_secret: 'k',
      client_id: 'c'
    }),
    { id: 'connection_1', client_secret: '[hidden]', client_id: 'c' }
  )
  t.deepEqual(public_connection({ id: 'connection_1' }), { id: 'connection_1' })
})

test('a secret from a file or stdin loses its trailing newline, a PEM keeps its lines', t => {
  t.is(clean_secret('s3cr3t\n', 'stdin'), 's3cr3t')
  const pem = '-----BEGIN PRIVATE KEY-----\nAAA\n-----END PRIVATE KEY-----'
  t.is(clean_secret(pem + '\n', 'key.p8'), pem)
  t.throws(() => clean_secret(' \n', 'stdin'), { message: /empty/ })
})

test('apple: the team and key ids go in provider_options, and only for apple', t => {
  t.deepEqual(
    connection_create_body({
      name: 'apple',
      type: 'apple',
      clientId: 'com.example.web',
      clientSecret: 'PEM',
      appleTeamId: 'ABCDE12345',
      appleKeyId: 'KEY123'
    }).provider_options,
    { team_id: 'ABCDE12345', key_id: 'KEY123' }
  )
  t.throws(
    () =>
      connection_create_body({
        name: 'google',
        type: 'google_oauth2',
        appleTeamId: 'ABCDE12345'
      }),
    { message: /only apply to apple/ }
  )
})
