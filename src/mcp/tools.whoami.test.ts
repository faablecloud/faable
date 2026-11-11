import test from 'ava'
import { version } from '../config'
import { TOOLS } from './tools'

const whoami = TOOLS.find(t => t.name === 'whoami')!

test('whoami shape: says which CLI version this MCP server runs', t => {
  const out = whoami.shape!(
    { email: 'ana@example.com', project: { id: 'team_1' } },
    {} as any
  ) as any
  t.is(out.email, 'ana@example.com')
  t.deepEqual(out.project, { id: 'team_1' })
  t.is(out.server_version, version)
  t.truthy(version)
})
