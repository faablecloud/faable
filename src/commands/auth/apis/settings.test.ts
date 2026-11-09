import test from 'ava'
import { api_settings_patch, parse_token_lifetime } from './settings'

test('token lifetime: whole seconds inside the range the API accepts', t => {
  t.is(parse_token_lifetime('3600'), 3600)
  t.is(parse_token_lifetime('60'), 60)
  t.is(parse_token_lifetime('2592000'), 2592000)
  for (const bad of [
    '59',
    '2592001',
    '0',
    '-3600',
    '3600.5',
    '1h',
    '',
    '1e4'
  ]) {
    t.throws(
      () => parse_token_lifetime(bad),
      { message: /60 and 2592000/ },
      bad
    )
  }
})

test('patch: only the settings passed, with their API field names', t => {
  t.deepEqual(api_settings_patch({}), {})
  t.deepEqual(
    api_settings_patch({
      tokenLifetime: '3600',
      includeRolesInAccessToken: true,
      skipConsent: false,
      description: 'Gateway'
    }),
    {
      token_lifetime: 3600,
      include_roles_in_access_token: true,
      skip_consent: false,
      description: 'Gateway'
    }
  )
})
