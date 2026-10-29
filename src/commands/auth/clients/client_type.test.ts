import test from 'ava'
import { client_type_patch, is_public_client } from './client_type'

test('web keeps its secret: nothing to change after create', t => {
  t.is(client_type_patch('web'), null)
  t.false(is_public_client('web'))
})

test('spa and native become public clients', t => {
  t.deepEqual(client_type_patch('spa'), {
    application_type: 'spa',
    token_endpoint_auth_method: 'none'
  })
  t.deepEqual(client_type_patch('native'), {
    application_type: 'native',
    token_endpoint_auth_method: 'none'
  })
  t.true(is_public_client('spa'))
})
