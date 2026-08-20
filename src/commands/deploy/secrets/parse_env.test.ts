import test from 'ava'
import { parse_env } from './parse_env'
import { NAME_MAX, VALUE_MAX } from './parse_pairs'

test('parses plain KEY=VALUE lines', t => {
  t.deepEqual(parse_env('A=1\nB=2\n'), [
    { name: 'A', value: '1' },
    { name: 'B', value: '2' }
  ])
})

test('skips blank lines and comments', t => {
  const env = ['# a comment', '', '   ', 'A=1', '   # indented comment'].join(
    '\n'
  )
  t.deepEqual(parse_env(env), [{ name: 'A', value: '1' }])
})

test('tolerates a leading "export"', t => {
  t.deepEqual(parse_env('export A=1'), [{ name: 'A', value: '1' }])
})

test('keeps "=" inside the value', t => {
  t.deepEqual(parse_env('DB=postgres://u:p@h/db?a=b=c'), [
    { name: 'DB', value: 'postgres://u:p@h/db?a=b=c' }
  ])
})

test('trims whitespace around name and unquoted value', t => {
  t.deepEqual(parse_env('  A =  1  '), [{ name: 'A', value: '1' }])
})

test('allows an empty value', t => {
  t.deepEqual(parse_env('A='), [{ name: 'A', value: '' }])
})

test('strips quotes and keeps spaces inside them', t => {
  t.deepEqual(parse_env('A="hello world"\nB=\'hello world\''), [
    { name: 'A', value: 'hello world' },
    { name: 'B', value: 'hello world' }
  ])
})

test('expands escapes in double quotes only', t => {
  t.deepEqual(parse_env('A="one\\ntwo"'), [{ name: 'A', value: 'one\ntwo' }])
  t.deepEqual(parse_env("B='one\\ntwo'"), [{ name: 'B', value: 'one\\ntwo' }])
})

test('keeps an escaped quote inside a double-quoted value', t => {
  t.deepEqual(parse_env('A="say \\"hi\\""'), [{ name: 'A', value: 'say "hi"' }])
})

test('reads a multi-line quoted value (PEM key)', t => {
  const env = 'KEY="-----BEGIN-----\nline1\nline2\n-----END-----"\nAFTER=1'
  t.deepEqual(parse_env(env), [
    { name: 'KEY', value: '-----BEGIN-----\nline1\nline2\n-----END-----' },
    { name: 'AFTER', value: '1' }
  ])
})

test('strips an inline comment after an unquoted value', t => {
  t.deepEqual(parse_env('A=1 # the answer'), [{ name: 'A', value: '1' }])
})

test('keeps a "#" that is part of an unquoted value', t => {
  t.deepEqual(parse_env('A=pa#ss'), [{ name: 'A', value: 'pa#ss' }])
})

test('keeps a "#" inside quotes', t => {
  t.deepEqual(parse_env('A="pa ## ss"'), [{ name: 'A', value: 'pa ## ss' }])
})

test('handles CRLF files', t => {
  t.deepEqual(parse_env('A=1\r\nB=2\r\n'), [
    { name: 'A', value: '1' },
    { name: 'B', value: '2' }
  ])
})

test('strips a UTF-8 BOM from the first name', t => {
  t.deepEqual(parse_env('﻿A=1'), [{ name: 'A', value: '1' }])
})

test('last occurrence of a repeated name wins', t => {
  t.deepEqual(parse_env('A=1\nA=2'), [{ name: 'A', value: '2' }])
})

test('rejects a line without "=" instead of ignoring it', t => {
  t.throws(() => parse_env('A=1\nOOPS\n', '.env'), {
    message: /^\.env:2: expected KEY=VALUE, got "OOPS"\.$/
  })
})

test('rejects a missing name', t => {
  t.throws(() => parse_env('=1'), { message: /:1: missing name before '='/ })
})

test('rejects an unterminated quote, pointing at the opening line', t => {
  t.throws(() => parse_env('A=1\nB="oops\nC=2\n'), {
    message: /^\.env:2: unterminated " quote for "B"\.$/
  })
})

test('reports the file position for over-limit values', t => {
  t.throws(() => parse_env(`A=1\nB=${'v'.repeat(VALUE_MAX + 1)}`), {
    message: /^\.env:2: Value for "B" exceeds/
  })
})

test('reports the file position for invalid names', t => {
  t.throws(() => parse_env(`A=1\n${'N'.repeat(NAME_MAX + 1)}=2`), {
    message: /^\.env:2: Secret name/
  })
})

test('uses the given source name in errors', t => {
  t.throws(() => parse_env('OOPS', '.env.production'), {
    message: /^\.env\.production:1:/
  })
})

test('an empty file yields no pairs', t => {
  t.deepEqual(parse_env('\n\n# nothing\n'), [])
})
