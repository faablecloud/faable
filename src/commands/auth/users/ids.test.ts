import test from 'ava'
import { parse_user_ids, wants_stdin } from './ids'

test('accepts explicit ids and dedupes preserving order', t => {
  t.deepEqual(
    parse_user_ids(['user_a1', 'user_b2', 'user_a1'], null),
    ['user_a1', 'user_b2']
  )
})

test('no argv ids + piped stdin reads whitespace-separated ids', t => {
  t.deepEqual(
    parse_user_ids([], ' user_a1\nuser_b2\tuser_c3 \n'),
    ['user_a1', 'user_b2', 'user_c3']
  )
})

test("a surviving '-' splices stdin ids in place", t => {
  t.deepEqual(parse_user_ids(['user_x9', '-'], 'user_a1'), ['user_x9', 'user_a1'])
})

test('stdin ids are appended once even without a dash marker', t => {
  t.deepEqual(parse_user_ids(['user_x9'], 'user_a1 user_x9'), [
    'user_x9',
    'user_a1'
  ])
})

test("'-' without stdin fails", t => {
  t.throws(() => parse_user_ids(['-'], null), { message: /stdin/ })
})

test('rejects ids without the user_ prefix, before any mutation', t => {
  t.throws(() => parse_user_ids(['user_ok1', 'app_nope'], null), {
    message: /Invalid user id.*app_nope/
  })
})

test('rejects an empty id list with a piping hint', t => {
  t.throws(() => parse_user_ids([], '   \n'), { message: /pipe them via stdin/ })
  t.throws(() => parse_user_ids([], null), { message: /No user ids/ })
})

test('wants_stdin: dash marker, or no ids on a non-TTY stdin', t => {
  t.true(wants_stdin(['-'], true))
  t.true(wants_stdin([], false))
  t.false(wants_stdin([], true))
  t.false(wants_stdin(['user_a1'], false))
})
