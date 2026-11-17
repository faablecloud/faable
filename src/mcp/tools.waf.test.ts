import test from 'ava'
import { permission_of } from './oauth'
import { tools_for } from './server'
import { TOOLS } from './tools'

const tool = (name: string) => TOOLS.find(t => t.name === name)!

test('WAF: list is a read; add and remove exist only with --writes', t => {
  const reads = tools_for({}).map(x => x.name)
  t.true(reads.includes('list_waf_rules'))
  t.is(permission_of(tool('list_waf_rules')), 'deploy:read')
  for (const name of ['add_waf_rule', 'remove_waf_rule']) {
    t.false(reads.includes(name), name)
    t.true(
      tools_for({ writes: true }).some(x => x.name === name),
      name
    )
    t.is(permission_of(tool(name)), 'deploy:write', name)
  }
})

test('add_waf_rule glues every free-text selector to its flag', t => {
  const flags = tool('add_waf_rule').flags({
    app: 'web',
    action: 'sink',
    pattern: '^/$',
    user_agent: '-weird',
    client_ip: '203.0.113.7',
    description: 'keepalive pinger'
  })
  t.deepEqual(flags, [
    '--action',
    'sink',
    '--pattern=^/$',
    '--user-agent=-weird',
    '--ip=203.0.113.7',
    '--description=keepalive pinger',
    '--app',
    'web'
  ])
  const limit = tool('add_waf_rule').flags({
    app: 'web',
    action: 'limit',
    pattern: '^/api/login$',
    rate: '10/m',
    per: 'rule',
    force: true
  })
  t.true(limit.includes('--rate') && limit.includes('10/m'))
  t.true(limit.includes('--per') && limit.includes('rule'))
  t.true(limit.includes('--force'))
})

test('remove_waf_rule addresses the rule by all it is', t => {
  t.deepEqual(
    tool('remove_waf_rule').flags({
      app: 'web',
      pattern: '^/$',
      client_ip: '203.0.113.7/32',
      action: 'deny'
    }),
    ['^/$', '--ip=203.0.113.7/32', '--action', 'deny', '--app', 'web']
  )
})

test('get_app_traffic returns top_ips, list_waf_rules only profile names', t => {
  const traffic = tool('get_app_traffic').shape!(
    {
      status_codes: [],
      top_ips: Array.from({ length: 12 }, (_, i) => ({
        ip: `203.0.113.${i}`,
        requests: 100 - i,
        user_agent: 'pinger',
        paths: 1,
        last_seen: 1,
        blockable: true
      })),
      degraded: []
    },
    {}
  ) as any
  t.is(traffic.top_ips.length, 10)
  t.is(traffic.top_ips[0].ip, '203.0.113.0')

  const waf = tool('list_waf_rules').shape!(
    {
      enabled: true,
      platform_profiles: [
        {
          name: 'sensitive-paths',
          action: 'deny',
          rule_count: 2,
          rules: [{ pattern: 'x' }]
        }
      ],
      rules: [{ client_ip: '203.0.113.7', action: 'sink', match: 'client_ip' }]
    },
    {}
  ) as any
  t.deepEqual(waf.platform_profiles, [
    {
      name: 'sensitive-paths',
      action: 'deny',
      match: undefined,
      rule_count: 2
    }
  ])
  t.deepEqual(waf.rules, [
    { client_ip: '203.0.113.7', action: 'sink', match: 'client_ip' }
  ])
  t.true(!!tool('list_waf_rules').untrusted)
})
