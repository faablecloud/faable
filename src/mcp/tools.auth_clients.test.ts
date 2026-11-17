import test from 'ava'
import { z } from 'zod'
import { TOOLS } from './tools'

const tool = (name: string) => TOOLS.find(t => t.name === name)!

test('list_auth_clients: each client says its signup protection, absent = off', t => {
  const out: any = tool('list_auth_clients').shape!(
    {
      data: [
        { id: 'client_old', client_id: 'old', name: 'Old' },
        { id: 'client_new', client_id: 'new', name: 'New', signup_protection: 'on_risk' },
        { id: 'client_strict', client_id: 'strict', name: 'Strict', signup_protection: 'always' }
      ],
      has_more: false
    },
    {}
  )
  t.deepEqual(
    out.data.map((c: any) => c.signup_protection),
    ['off', 'on_risk', 'always']
  )
})

test('update_auth_client_signup_protection: one flag on clients update, a write', t => {
  const def = tool('update_auth_client_signup_protection')
  t.deepEqual(def.command, ['auth', 'clients', 'update'])
  t.deepEqual(def.flags({ client: 'my-app', mode: 'always' }), [
    'my-app',
    '--signup-protection',
    'always'
  ])
  t.deepEqual(
    def.flags({ client: 'my-app', mode: 'off', tenant: 'account_1', project: 'p' }),
    ['my-app', '--signup-protection', 'off', '--account', 'account_1', '--project', 'p']
  )
  t.true(def.write)
  t.false(def.annotations.readOnlyHint)
  t.false(def.annotations.destructiveHint)
})

test('update_auth_client_signup_protection: the mode is one of the three', t => {
  const input = z.object(tool('update_auth_client_signup_protection').input)
  t.true(input.safeParse({ client: 'c', mode: 'on_risk' }).success)
  t.false(input.safeParse({ client: 'c', mode: 'strict' }).success)
  t.false(input.safeParse({ client: 'c' }).success)
})

test('update_auth_client_signup_protection shape: the mode after the write', t => {
  const out = tool('update_auth_client_signup_protection').shape!(
    { id: 'client_1', client_id: 'abc', name: 'App', signup_protection: 'always', client_secret: 'x' },
    {}
  )
  t.deepEqual(out, { id: 'client_1', client_id: 'abc', name: 'App', signup_protection: 'always' })
})
