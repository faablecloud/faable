import test from 'ava'
import { mask_value } from './mask'

test('empty value is labelled', t => {
  t.is(mask_value(''), '(empty)')
})

test('short values are fully masked without leaking their length', t => {
  t.is(mask_value('abc'), '••••••')
  t.is(mask_value('1234567'), '••••••')
})

test('values of 8+ chars show a 4-char prefix', t => {
  t.is(mask_value('12345678'), '1234…')
  t.is(mask_value('sk_live_abcdef'), 'sk_l…')
})
