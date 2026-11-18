import test from 'ava'
import { z } from 'zod'
import { permission_of } from './oauth'
import { tools_for } from './server'
import { TOOLS } from './tools'

const tool = (name: string) => TOOLS.find(t => t.name === name)!

test('Challenge: list and usage are reads; create/update/rotate/delete need --writes', t => {
  const reads = tools_for({}).map(x => x.name)
  for (const name of ['list_challenge_sites', 'get_challenge_usage']) {
    t.true(reads.includes(name), name)
    t.is(permission_of(tool(name)), 'deploy:read', name)
  }
  const writes = tools_for({ writes: true }).map(x => x.name)
  for (const name of [
    'create_challenge_site',
    'update_challenge_site',
    'rotate_challenge_secret',
    'delete_challenge_site'
  ]) {
    t.false(reads.includes(name), name)
    t.true(writes.includes(name), name)
    t.is(permission_of(tool(name)), 'deploy:write', name)
  }
})

test('Challenge: create, update and rotate are hosted; delete only local', t => {
  const hosted = tools_for({ writes: true, hosted: true }).map(x => x.name)
  t.true(hosted.includes('create_challenge_site'))
  t.true(hosted.includes('update_challenge_site'))
  t.true(hosted.includes('rotate_challenge_secret'))
  t.true(tool('rotate_challenge_secret').annotations.destructiveHint)
  t.false(hosted.includes('delete_challenge_site'))
})

test('create_challenge_site glues the name and every domain to its flag', t => {
  t.deepEqual(
    tool('create_challenge_site').flags({
      name: '-weird name',
      domains: ['example.com', 'shop.example.com'],
      project: 'p'
    }),
    [
      '--name=-weird name',
      '--domain=example.com',
      '--domain=shop.example.com',
      '--project',
      'p'
    ]
  )
})

test('rotate and delete never prompt: --yes, the site first', t => {
  for (const name of ['rotate_challenge_secret', 'delete_challenge_site']) {
    t.deepEqual(tool(name).flags({ site: 'site_1' }), ['site_1', '--yes'], name)
  }
})

test('the secret comes back once, with the note to store it', t => {
  for (const name of ['create_challenge_site', 'rotate_challenge_secret']) {
    const out = tool(name).shape!(
      { id: 'site_1', site_key: 'fcs_pk_1', secret: 'fcs_sk_1' },
      {}
    ) as any
    t.is(out.secret, 'fcs_sk_1', name)
    t.regex(out.note, /only time the secret is shown/, name)
  }
  // The listing never carries one, even if the service sent it.
  const listed = tool('list_challenge_sites').shape!(
    { data: [{ id: 'site_1', secret: 'fcs_sk_1', site_key: 'fcs_pk_1' }] },
    {}
  ) as any
  t.false('secret' in listed.data[0])
})

test('a site ref starting with "-" is refused by the schema', t => {
  const schema = tool('delete_challenge_site').input
    .site as unknown as z.ZodType
  t.false(schema.safeParse('--yes').success)
  t.true(schema.safeParse('site_1').success)
})
