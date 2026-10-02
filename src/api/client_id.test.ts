import test from 'ava'
import { version } from '../config'
import { create_base_client } from './base_client'
import { CLI_CLIENT, client_name } from './client_id'

test('the Deploy API is told who calls, like the auth server', t => {
  const headers = create_base_client().defaults.headers as unknown as Record<
    string,
    unknown
  >
  t.is(headers['x-faable-client'], CLI_CLIENT)
  t.is(CLI_CLIENT, `faable-cli/${version}`)
})

test('FAABLE_CLIENT_NAME names the driver, only within faable-*', t => {
  t.is(client_name({}), 'faable-cli')
  t.is(client_name({ FAABLE_CLIENT_NAME: 'faable-mcp' }), 'faable-mcp')
  t.is(client_name({ FAABLE_CLIENT_NAME: ' Faable-MCP ' }), 'faable-mcp')
  // Never another client's name, nor a version smuggled in.
  t.is(client_name({ FAABLE_CLIENT_NAME: 'dashboard' }), 'faable-cli')
  t.is(client_name({ FAABLE_CLIENT_NAME: 'faable-mcp/9.9.9' }), 'faable-cli')
})
