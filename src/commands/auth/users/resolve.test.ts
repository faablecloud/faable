import test from 'ava'
import { resolve_user_credential } from './resolve'

// A fake SDK `credentialsList(params)`: returns a paginator (`.pass()`) over a
// fixed set, filtered by the `user`/`connection` query the resolver sends.
const fake_api = (creds: Array<Record<string, unknown>>) => ({
  credentialsList(params?: { user?: string; connection?: string }) {
    return {
      async pass() {
        let results = creds
        if (params?.connection) {
          results = results.filter(c => c.connection === params.connection)
        }
        return { results, next: null }
      }
    }
  }
})

const CRED = (id: string, connection: string, email: string) => ({
  id,
  connection,
  email
})

test('returns the single database credential of a one-connection tenant', async t => {
  const api = fake_api([CRED('credentials_1', 'connection_db', 'ana@login.com')])
  const cred = await resolve_user_credential(api as never, 'user_1')
  t.is(cred.id, 'credentials_1')
  t.is(cred.email, 'ana@login.com')
})

test('throws when the user has no database credential', async t => {
  const api = fake_api([])
  await t.throwsAsync(() => resolve_user_credential(api as never, 'user_1'), {
    message: /no database credential/
  })
})

test('with several credentials, demands --connection', async t => {
  const api = fake_api([
    CRED('credentials_1', 'connection_a', 'ana@a.com'),
    CRED('credentials_2', 'connection_b', 'ana@b.com')
  ])
  await t.throwsAsync(() => resolve_user_credential(api as never, 'user_1'), {
    message: /pass --connection/
  })
})

test('with several credentials, --connection picks the one', async t => {
  const api = fake_api([
    CRED('credentials_1', 'connection_a', 'ana@a.com'),
    CRED('credentials_2', 'connection_b', 'ana@b.com')
  ])
  const cred = await resolve_user_credential(api as never, 'user_1', 'connection_b')
  t.is(cred.id, 'credentials_2')
})
