import test from 'ava'
import { Secret } from '../../../api/FaableApi'
import { merge_app_secrets, remove_app_secret } from './merge'

const secret = (
  name: string,
  value: string,
  related_model: Secret['related_model'] = 'app'
): Secret => ({
  id: `secret_${name}`,
  related: 'app_123',
  related_model,
  name,
  value
})

test('merge overwrites existing names and appends new ones', t => {
  const existing = [secret('A', '1'), secret('B', '2')]
  const result = merge_app_secrets(existing, [
    { name: 'B', value: 'updated' },
    { name: 'C', value: '3' }
  ])
  t.deepEqual(result, [
    { name: 'A', value: '1' },
    { name: 'B', value: 'updated' },
    { name: 'C', value: '3' }
  ])
})

test('merge never writes profile-inherited secrets back as app secrets', t => {
  const existing = [secret('A', '1'), secret('TEAM_KEY', 'x', 'profile')]
  const result = merge_app_secrets(existing, [{ name: 'B', value: '2' }])
  t.deepEqual(result, [
    { name: 'A', value: '1' },
    { name: 'B', value: '2' }
  ])
})

test('merge into an empty set just returns the updates', t => {
  t.deepEqual(merge_app_secrets([], [{ name: 'A', value: '1' }]), [
    { name: 'A', value: '1' }
  ])
})

test('remove drops the named secret and keeps the rest', t => {
  const existing = [secret('A', '1'), secret('B', '2')]
  t.deepEqual(remove_app_secret(existing, 'A'), [{ name: 'B', value: '2' }])
})

test('remove of a missing name lists the existing app secrets', t => {
  const existing = [secret('A', '1')]
  t.throws(() => remove_app_secret(existing, 'NOPE'), {
    message: /Existing secrets: A/
  })
})

test('remove of a profile-inherited secret explains it is team-managed', t => {
  const existing = [secret('TEAM_KEY', 'x', 'profile')]
  t.throws(() => remove_app_secret(existing, 'TEAM_KEY'), {
    message: /inherited from the team profile/
  })
})
