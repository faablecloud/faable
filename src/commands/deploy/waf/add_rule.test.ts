import test from 'ava'
import { log } from '../../../log'
import {
  add_rule,
  check_selector,
  describe_selector,
  refuse_ip,
  rule_matches_request,
  same_ip,
  undo_args
} from './add_rule'

test('describe_selector says what a rule actually catches', t => {
  t.is(describe_selector({ pattern: '^/wp-admin' }), 'requests for ^/wp-admin')
  t.is(
    describe_selector({ user_agent: 'YisouSpider' }),
    'requests from user-agents matching YisouSpider'
  )
  t.is(
    describe_selector({ pattern: '^/api/', user_agent: 'curl' }),
    'requests for ^/api/ from user-agents matching curl'
  )
})

test('rule_matches_request is what catches a server that dropped a field', t => {
  // The scenario: a NEW cli against an OLD server, which has no `user_agent`
  // on this endpoint and silently stores the path half alone — turning "block
  // /login for this bot" into "block /login for everyone". The client has to
  // notice, because no server-side schema can prevent it.
  const want = { pattern: '^/login', user_agent: 'YisouSpider' }

  t.true(
    rule_matches_request(
      { pattern: '^/login', user_agent: 'YisouSpider', action: 'deny' },
      want,
      'deny'
    )
  )
  t.false(
    rule_matches_request({ pattern: '^/login', action: 'deny' }, want, 'deny'),
    'the user-agent was dropped'
  )
  t.false(
    rule_matches_request(
      { pattern: '^/login', user_agent: 'YisouSpider', action: 'sink' },
      want,
      'deny'
    ),
    'the action has to match too'
  )
})

test('undo_args reverses exactly the rule that was created', t => {
  t.is(undo_args({ pattern: '^/robots\\.txt$' }), "'^/robots\\.txt$'")
  t.is(undo_args({ user_agent: 'YisouSpider' }), "--user-agent 'YisouSpider'")
  t.is(
    undo_args({ pattern: '^/api/', user_agent: 'curl' }),
    "'^/api/' --user-agent 'curl'"
  )
})

test('describe_selector distinguishes a query rule from a path one', t => {
  t.is(
    describe_selector({ query: 'rest_route' }),
    'requests carrying ?rest_route'
  )
  t.is(
    describe_selector({ pattern: '^/$', query: 'rest_route' }),
    'requests for ^/$ carrying ?rest_route'
  )
})

test('rule_matches_request catches a server that dropped the query half', t => {
  // The dangerous direction, and the reason this guard is not symmetric with
  // the user-agent one: the api LIFTS the site-root guard for a path ANDed
  // with a parameter, so `^/$` is a legal thing to send. An old server that
  // drops `query` stores exactly the rule that guard exists to refuse — the
  // whole app behind a 403.
  const want = { pattern: '^/$', query: 'rest_route' }
  t.false(
    rule_matches_request(
      { pattern: '^/$', action: 'deny', match: 'path' },
      want,
      'deny'
    )
  )
  t.true(
    rule_matches_request(
      {
        pattern: '^/$',
        query: 'rest_route',
        action: 'deny',
        match: 'path_query'
      },
      want,
      'deny'
    )
  )
})

test('undo_args reverses a query rule exactly', t => {
  t.is(undo_args({ query: 'rest_route' }), "--query 'rest_route'")
  t.is(
    undo_args({ pattern: '^/$', query: 'rest_route' }),
    "'^/$' --query 'rest_route'"
  )
})

// A monitor rule reads the past: right after adding it, the CLI says what it
// WOULD have stopped in the last week (backlog §469), and how to promote it.
test.serial(
  'monitor says what the rule would have stopped, and blocks nothing',
  async t => {
    const lines: string[] = []
    const orig = log.info
    ;(log as any).info = (m: string) => lines.push(m)
    const api: any = {
      addAppWafRule: async () => ({
        enabled: true,
        platform_profiles: [],
        rules: [{ pattern: '^/admin', action: 'monitor', match: 'path' }]
      }),
      appWafWouldBlock: async () => ({
        would_block: {
          total: 12,
          top_rules: [{ rule: 'rule:0', requests: 12 }]
        },
        rules: [{ id: 'rule:0', action: 'monitor', pattern: '^/admin' }]
      })
    }
    try {
      await add_rule({
        api,
        app_id: 'app_1',
        app_name: 'shop',
        app_url: 'shop.faable.link',
        pattern: '^/admin',
        action: 'monitor'
      })
    } finally {
      ;(log as any).info = orig
    }
    const out = lines.join('\n')
    t.regex(out, /monitor only, nothing is blocked/)
    t.regex(out, /would have stopped 12 requests/)
    t.regex(out, /faable deploy waf block '\^\/admin' -a app_1/)
    t.regex(out, /--action monitor/)
    t.notRegex(out, /at the edge/)
  }
)

test('describe_selector and undo_args name an IP rule', t => {
  t.is(describe_selector({ ip: '203.0.113.7' }), 'requests from 203.0.113.7')
  t.is(
    describe_selector({ pattern: '^/$', ip: '203.0.113.0/24' }),
    'requests for ^/$ from 203.0.113.0/24'
  )
  t.is(undo_args({ ip: '203.0.113.7' }), "--ip '203.0.113.7'")
  t.is(
    undo_args({ pattern: '^/$', ip: '203.0.113.7' }),
    "'^/$' --ip '203.0.113.7'"
  )
})

test('check_selector refuses what the api refuses, with its words', t => {
  t.regex(
    t.throws(() => check_selector('block', { ip: '1.2.3.4', userAgent: 'x' }))!
      .message,
    /A client_ip rule can be combined with a path, not with a user-agent or a query parameter/
  )
  t.throws(() => check_selector('block', { ip: '1.2.3.4', query: 'q' }))
  t.regex(
    t.throws(() => check_selector('sink', {}))!.message,
    /--ip 203\.0\.113\.7/
  )
  t.true(check_selector('sink', { ip: '1.2.3.4' }))
  t.true(check_selector('block', { pattern: '^/$', ip: '1.2.3.4' }))
  // allow and limit have no --ip: refused, never silently dropped.
  t.regex(
    t.throws(() => refuse_ip('allow', '1.2.3.4'))!.message,
    /no client_ip/
  )
  t.regex(
    t.throws(() => refuse_ip('limit', '1.2.3.4'))!.message,
    /cannot target a client_ip/
  )
  t.true(refuse_ip('limit', undefined))
})

test('same_ip compares networks, not strings', t => {
  // What the server does to an ip: drops /32, clears host bits, compresses
  // and lowercases IPv6. None of that is a dropped field.
  t.true(same_ip('203.0.113.7', '203.0.113.7/32'))
  t.true(same_ip('203.0.113.0/24', '203.0.113.7/24'))
  t.true(same_ip('2001:db8::/48', '2001:DB8:0:0::1/48'))
  t.true(same_ip('2001:db8::1', '2001:db8::1/128'))
  t.false(same_ip('203.0.113.7', '203.0.113.8'))
  t.false(same_ip('203.0.113.0/24', '203.0.113.0/25'))
  t.false(same_ip(undefined, '203.0.113.7'))
  t.true(same_ip(undefined, undefined))
})

test('rule_matches_request catches a server that dropped the ip', t => {
  // `^/$` with an ip is legal without --force; stored without it, it is the
  // site root for every visitor.
  const want = { pattern: '^/$', ip: '203.0.113.7/32' }
  t.false(
    rule_matches_request(
      { pattern: '^/$', action: 'deny', match: 'path' },
      want,
      'deny'
    )
  )
  t.true(
    rule_matches_request(
      {
        pattern: '^/$',
        client_ip: '203.0.113.7',
        action: 'deny',
        match: 'path_client_ip'
      },
      want,
      'deny'
    )
  )
  t.true(
    rule_matches_request(
      { client_ip: '203.0.113.7', action: 'sink', match: 'client_ip' },
      { ip: '203.0.113.7' },
      'sink'
    )
  )
  // A path rule asked for is not satisfied by a path+ip rule.
  t.false(
    rule_matches_request(
      {
        pattern: '^/$',
        client_ip: '203.0.113.7',
        action: 'deny',
        match: 'path_client_ip'
      },
      { pattern: '^/$' },
      'deny'
    )
  )
})

test.serial('an ip rule that comes back without its ip is undone', async t => {
  const removed: any[] = []
  const api: any = {
    addAppWafRule: async () => ({
      enabled: true,
      platform_profiles: [],
      rules: [{ pattern: '^/$', action: 'deny', match: 'path' }]
    }),
    removeAppWafRule: async (_: string, body: any) => {
      removed.push(body)
      return { enabled: true, platform_profiles: [], rules: [] }
    }
  }
  const e = await t.throwsAsync(
    add_rule({
      api,
      app_id: 'app_1',
      app_name: 'shop',
      app_url: 'shop.faable.link',
      pattern: '^/$',
      ip: '203.0.113.7',
      action: 'deny'
    })
  )
  t.regex(e!.message, /does not support IP rules/)
  t.deepEqual(removed[0], {
    pattern: '^/$',
    user_agent: undefined,
    query: undefined,
    client_ip: '203.0.113.7',
    action: 'deny'
  })
})

test.serial(
  'an ip rule is reported and undone as the server stored it',
  async t => {
    const lines: string[] = []
    const orig = log.info
    ;(log as any).info = (m: string) => lines.push(m)
    const api: any = {
      addAppWafRule: async () => ({
        enabled: true,
        platform_profiles: [],
        rules: [
          { client_ip: '203.0.113.7', action: 'sink', match: 'client_ip' }
        ]
      })
    }
    try {
      await add_rule({
        api,
        app_id: 'app_1',
        app_name: 'shop',
        app_url: 'shop.faable.link',
        ip: '203.0.113.7/32',
        action: 'sink'
      })
    } finally {
      ;(log as any).info = orig
    }
    const out = lines.join('\n')
    t.regex(out, /requests from 203\.0\.113\.7 → 404 at the edge/)
    t.regex(out, /never X-Forwarded-For/)
    t.regex(out, /faable deploy waf rm --ip '203\.0\.113\.7' -a app_1/)
    t.notRegex(out, /\/32/)
  }
)
