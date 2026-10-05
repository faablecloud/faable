import test from 'ava'
import { compose_query, term, time_term } from './query'

test('compose_query joins terms with spaces', t => {
  t.is(compose_query(['a:1', 'b:2']), 'a:1 b:2')
})

test('compose_query drops empty terms', t => {
  t.is(compose_query(['a:1', undefined, false]), 'a:1')
})

test('compose_query returns undefined with nothing to filter', t => {
  t.is(compose_query([undefined, false]), undefined)
  t.is(compose_query([], '   '), undefined)
})

test('compose_query appends the raw passthrough query', t => {
  t.is(compose_query(['status:failed'], 'origin:oauth'), 'status:failed origin:oauth')
  t.is(compose_query([], 'suspended:true'), 'suspended:true')
})

test('term builds field:value and skips empty values', t => {
  t.is(term('type', 'admin.user.updated'), 'type:admin.user.updated')
  t.is(term('type', undefined), undefined)
  t.is(term('type', ''), undefined)
})

test('term allows ids, emails and dotted values', t => {
  t.is(term('user', 'user_6a84aa8a672a3fed6dbb43ea'), 'user:user_6a84aa8a672a3fed6dbb43ea')
  t.is(term('email', 'a-b@x.dev'), 'email:a-b@x.dev')
})

test('term rejects values FaableQL cannot parse', t => {
  t.throws(() => term('type', 'has spaces'), { message: /Invalid value/ })
  t.throws(() => term('type', 'colon:inside'), { message: /Invalid value/ })
})

test('time_term accepts unix-millis and YYYY-MM-DD', t => {
  t.is(time_term('since', '1787080301000'), 'since:1787080301000')
  t.is(time_term('until', '2026-08-18'), 'until:2026-08-18')
  t.is(time_term('since', undefined), undefined)
})

test('time_term rejects ISO timestamps (FaableQL bans ":" in values)', t => {
  t.throws(() => time_term('since', '2026-08-18T19:00:00Z'), {
    message: /unix-millis or YYYY-MM-DD/
  })
  t.throws(() => time_term('until', 'yesterday'), {
    message: /unix-millis or YYYY-MM-DD/
  })
})

import { range_term, time_value } from './query'

test('time_value: a relative age is that long before now, in unix-millis', t => {
  const now = 1_800_000_000_000
  t.is(time_value('since', '24h', now), String(now - 86_400_000))
  t.is(time_value('since', '30m', now), String(now - 1_800_000))
  t.is(time_value('since', '7d', now), String(now - 7 * 86_400_000))
})

test('time_value: unix-millis and dates pass through; anything else is refused', t => {
  t.is(time_value('since', '1787080301000'), '1787080301000')
  t.is(time_value('since', '2026-10-04'), '2026-10-04')
  t.throws(() => time_value('since', 'yesterday'), { message: /--since/ })
  t.throws(() => time_value('since', '2026-10-04T10:00:00Z'))
})

test('range_term names the server field, not the flag', t => {
  t.is(
    range_term('last_login_since', 'last-login-since', '1h', 3_600_000),
    'last_login_since:0'
  )
  t.is(range_term('created_until', 'created-until', undefined), undefined)
})
