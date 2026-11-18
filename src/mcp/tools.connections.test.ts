import test from 'ava'
import { tools_for } from './server'
import { TOOLS } from './tools'

const tool = (name: string) => TOOLS.find(t => t.name === name)!

test('connection writes: --writes on the local server only, never hosted', t => {
  for (const name of ['create_auth_connection', 'update_auth_connection']) {
    t.true(tool(name).write, name)
    t.true(tool(name).local_only, name)
    t.false(
      tools_for({}).some(x => x.name === name),
      name
    )
    t.true(
      tools_for({ writes: true }).some(x => x.name === name),
      name
    )
    t.false(
      tools_for({ writes: true, hosted: true }).some(x => x.name === name),
      name
    )
  }
})

test('create_auth_connection: the client secret goes on stdin, never in argv', t => {
  const def = tool('create_auth_connection')
  const a = {
    name: 'okta',
    type: 'oidc',
    client_id: 'abc',
    client_secret: 's3cr3t',
    issuer: 'https://acme.okta.com',
    scope: ['openid', 'email'],
    tenant: 'account_1'
  }
  const flags = def.flags(a)
  t.false(flags.some(f => f.includes('s3cr3t')))
  t.deepEqual(flags, [
    '--name=okta',
    '--type',
    'oidc',
    '--client-id=abc',
    '--client-secret-file',
    '-',
    '--issuer=https://acme.okta.com',
    '--scope=openid',
    '--scope=email',
    '--account',
    'account_1'
  ])
  t.is(def.stdin!(a), 's3cr3t')
  // No secret, no stdin flag: the CLI would wait on an empty pipe for nothing.
  t.false(
    def.flags({ name: 'email', type: 'passwordless_email' }).includes('-')
  )
  t.false(
    def
      .flags({ name: 'db', type: 'database', enabled: false })
      .includes('--enabled')
  )
  t.true(
    def
      .flags({ name: 'db', type: 'database', enabled: false })
      .includes('--no-enabled')
  )
})

test('the agent never gets a connection secret back', t => {
  const row = tool('create_auth_connection').shape!(
    {
      id: 'connection_1',
      connection_name: 'okta',
      connection_type: 'oidc',
      enabled: true,
      client_secret: 's3cr3t'
    },
    {}
  )
  t.false(JSON.stringify(row).includes('s3cr3t'))
})

test('update_auth_connection turns it on or off', t => {
  const def = tool('update_auth_connection')
  t.deepEqual(def.flags({ connection: 'email', enabled: false }), [
    'email',
    '--no-enabled'
  ])
  t.deepEqual(def.flags({ connection: 'email', enabled: true }), [
    'email',
    '--enabled'
  ])
})
