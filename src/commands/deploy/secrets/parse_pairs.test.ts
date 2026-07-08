import test from 'ava'
import { NAME_MAX, VALUE_MAX, parse_pairs } from './parse_pairs'

test('parses multiple KEY=VALUE pairs', t => {
  t.deepEqual(parse_pairs(['A=1', 'B=2']), [
    { name: 'A', value: '1' },
    { name: 'B', value: '2' }
  ])
})

test('splits on the first "=" only, value keeps the rest', t => {
  t.deepEqual(parse_pairs(['DB=postgres://u:p@h/db?a=b=c']), [
    { name: 'DB', value: 'postgres://u:p@h/db?a=b=c' }
  ])
})

test('allows an empty value (KEY=)', t => {
  t.deepEqual(parse_pairs(['KEY=']), [{ name: 'KEY', value: '' }])
})

test('rejects a pair without "="', t => {
  t.throws(() => parse_pairs(['FOO']), { message: /KEY=VALUE/ })
})

test('rejects an empty name (=bar)', t => {
  t.throws(() => parse_pairs(['=bar']), { message: /KEY=VALUE/ })
})

test('rejects names over the API limit', t => {
  const name = 'A'.repeat(NAME_MAX + 1)
  t.throws(() => parse_pairs([`${name}=x`]), {
    message: new RegExp(`${NAME_MAX} characters`)
  })
})

test('rejects values over the API limit', t => {
  const value = 'v'.repeat(VALUE_MAX + 1)
  t.throws(() => parse_pairs([`KEY=${value}`]), {
    message: new RegExp(`${VALUE_MAX} characters`)
  })
})

test('accepts names and values exactly at the limits', t => {
  const name = 'A'.repeat(NAME_MAX)
  const value = 'v'.repeat(VALUE_MAX)
  const [pair] = parse_pairs([`${name}=${value}`])
  t.is(pair.name.length, NAME_MAX)
  t.is(pair.value.length, VALUE_MAX)
})
