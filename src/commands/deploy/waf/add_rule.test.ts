import test from 'ava'
import { describe_selector, rule_matches_request, undo_args } from './add_rule'

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
