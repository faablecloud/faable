import test from 'ava'
import { assertEmailEvents, assertRecipients, isEmail } from './shared'

test('email events: the three with a template pass', t => {
  t.notThrows(() =>
    assertEmailEvents(['user.created', 'user.updated', 'credentials.exported'])
  )
})

test('email events: one without a template is refused and named', t => {
  const err = t.throws(() => assertEmailEvents(['user.created', 'auth.login']))
  t.regex(err!.message, /auth\.login/)
  t.regex(err!.message, /faable auth webhooks/)
})

test('recipients: a malformed address is refused and named', t => {
  t.notThrows(() => assertRecipients(['marc@faable.com']))
  const err = t.throws(() => assertRecipients(['marc@faable.com', 'nope']))
  t.regex(err!.message, /nope/)
})

test('isEmail tells email subscriptions from webhooks', t => {
  t.true(isEmail({ channel: 'email' }))
  t.false(isEmail({ channel: 'webhook' }))
})
