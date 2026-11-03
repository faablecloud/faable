import test from 'ava'
import { TOOLS } from './tools'

const tool = (name: string) => TOOLS.find(t => t.name === name)!
// Every shape takes (data, args); the tests only exercise the mapping.
const shape = (name: string, data: unknown): any => tool(name).shape!(data, {} as any)

test('set_auth_user_password: the password goes on stdin, never in argv', t => {
  const def = tool('set_auth_user_password')
  // A literal password: on stdin, absent from the command line.
  const flags = def.flags({ user: 'ana@example.com', password: 's3cr3t' })
  t.false(flags.includes('s3cr3t'))
  t.false(flags.includes('--password'))
  t.deepEqual(flags, ['ana@example.com', '--yes'])
  t.is(def.stdin!({ user: 'ana@example.com', password: 's3cr3t' }), 's3cr3t')
  // --generate: a flag, and nothing piped (the CLI makes its own).
  const gen = def.flags({ user: 'ana@example.com', generate: true })
  t.true(gen.includes('--generate'))
  t.is(def.stdin!({ user: 'ana@example.com', generate: true }), undefined)
  t.true(def.write)
  t.false(def.annotations.idempotentHint)
  t.false(def.annotations.destructiveHint)
})

test('update_auth_user: maps profile flags and the login-identifier opt-out', t => {
  const def = tool('update_auth_user')
  t.deepEqual(def.flags({ user: 'u', email: 'ana@new.com' }), [
    'u',
    '--email',
    'ana@new.com',
    '--yes'
  ])
  // false → the negated flag; true → the plain one.
  t.true(def.flags({ user: 'u', email_verified: false }).includes('--no-email-verified'))
  t.true(def.flags({ user: 'u', email_verified: true }).includes('--email-verified'))
  t.true(
    def
      .flags({ user: 'u', email: 'ana@new.com', profile_only: true })
      .includes('--profile-only')
  )
  t.true(def.write)
})

test('get_auth_user shape: surfaces the database login identifier', t => {
  const out = shape('get_auth_user', {
    id: 'user_1',
    email: 'ana@profile.com',
    credentials: [
      { connection: 'conn_1', connection_name: 'default', email: 'ana@login.com' }
    ],
    identities: []
  })
  t.deepEqual(out.credentials, [{ connection: 'default', identifier: 'ana@login.com' }])
})

test('list_auth_logs shape: a failed login carries the attempted identifier', t => {
  const out = shape('list_auth_logs', {
    data: [
      // Failed: no user resolves — the typed identifier is the whole point.
      {
        createdAt: 't1',
        type: 'auth.password_login',
        status: 'failed',
        data: { email: 'esantos@usal.es' }
      },
      // Success: user resolves and equals data.email → no redundant field.
      {
        createdAt: 't2',
        type: 'auth.password_login',
        status: 'success',
        user: { id: 'user_1', email: 'ana@login.com' },
        data: { email: 'ana@login.com' }
      }
    ],
    has_more: false
  })
  t.is(out.events[0].attempted_identifier, 'esantos@usal.es')
  t.false('attempted_identifier' in out.events[1])
  t.is(out.events[1].email, 'ana@login.com')
})

test('diagnose_auth_login: passes the identifier through, read-only', t => {
  const def = tool('diagnose_auth_login')
  t.deepEqual(def.flags({ identifier: 'ana@personal.com' }), ['ana@personal.com'])
  t.true(def.annotations.readOnlyHint)
  t.falsy(def.write)
})

test('get_auth_recovery_link: prints the link and returns it shaped', t => {
  const def = tool('get_auth_recovery_link')
  const flags = def.flags({ user: 'ana@example.com' })
  t.true(flags.includes('--print'))
  t.true(flags.includes('--yes'))
  const out = shape('get_auth_recovery_link', {
    user_id: 'user_1',
    ticket_id: 'tkt_1',
    channel: 'email',
    link: 'https://tenant.auth.faable.link/flow/change-password?ticket=tkt_1',
    status: 'sent'
  })
  t.is(out.link, 'https://tenant.auth.faable.link/flow/change-password?ticket=tkt_1')
  t.is(out.ticket_id, 'tkt_1')
  t.is(out.channel, 'email')
  t.true(def.write)
})
