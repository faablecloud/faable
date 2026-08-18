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
