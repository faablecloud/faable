import test from 'ava'
import {
  effective_signup_protection,
  signup_protection_patch
} from './signup_protection'

test('a client without the field is off', t => {
  t.is(effective_signup_protection({}), 'off')
  t.is(effective_signup_protection({ signup_protection: null }), 'off')
  t.is(effective_signup_protection(undefined), 'off')
})

test('the stored mode is shown as is', t => {
  t.is(effective_signup_protection({ signup_protection: 'on_risk' }), 'on_risk')
  t.is(effective_signup_protection({ signup_protection: 'always' }), 'always')
})

test('the request body carries the mode only when one was passed', t => {
  t.deepEqual(signup_protection_patch(undefined), {})
  t.deepEqual(signup_protection_patch('always'), { signup_protection: 'always' })
  t.deepEqual(signup_protection_patch('off'), { signup_protection: 'off' })
})
