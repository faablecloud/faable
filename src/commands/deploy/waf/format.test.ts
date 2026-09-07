import test from 'ava'
import { action_label, format_waf } from './format'

test('action labels explain what the caller will actually see', t => {
  t.is(action_label('deny'), '403 (blocked at the edge)')
  t.is(action_label('sink'), '404 (answered by Faable, app not woken)')
  // Anything the server grows later prints as-is instead of being hidden.
  t.is(action_label('ratelimit'), 'ratelimit')
})

test('a tenant sees platform profiles by name, without the patterns', t => {
  const out = format_waf({
    enabled: true,
    platform_profiles: [
      { name: 'sensitive-paths', action: 'deny', rule_count: 37 }
    ],
    rules: []
  }).join('\n')

  t.regex(out, /sensitive-paths — 37 rule\(s\)/)
  t.notRegex(out, /\\\.env/)
  t.regex(out, /Your rules:\n {2}\(none\)/)
})

test('an admin also sees the platform patterns', t => {
  const out = format_waf({
    enabled: true,
    platform_profiles: [
      {
        name: 'sensitive-paths',
        action: 'deny',
        rule_count: 1,
        rules: [{ pattern: '/\\.git/', description: 'Git metadata' }]
      }
    ],
    rules: []
  }).join('\n')

  t.regex(out, /\/\\\.git\/ {2}# Git metadata/)
})

test('own rules print their action and description', t => {
  const out = format_waf({
    enabled: true,
    platform_profiles: [],
    rules: [
      {
        pattern: '^/robots\\.txt$',
        action: 'sink',
        description: 'the app 404s it anyway'
      },
      { pattern: '^/\\.well-known/', action: 'deny' }
    ]
  }).join('\n')

  t.regex(out, /\^\/robots\\\.txt\$ → 404 \(answered by Faable/)
  t.regex(out, /the app 404s it anyway/)
  t.regex(out, /\^\/\\\.well-known\/ → 403 \(blocked at the edge\)/)
})

test('a disabled binding says so before listing anything', t => {
  // An admin can switch an app's WAF off entirely; listing rules as if they
  // were live would be a lie.
  const out = format_waf({
    enabled: false,
    platform_profiles: [],
    rules: [{ pattern: '^/robots\\.txt$', action: 'sink' }]
  })

  t.regex(out[0], /WAF disabled for this app/)
})

test('a user-agent rule says it has no path restriction', t => {
  // Printing it as a bare pattern would hide that it applies to the whole app.
  const out = format_waf({
    enabled: true,
    platform_profiles: [],
    rules: [{ user_agent: 'YisouSpider', action: 'deny', match: 'user_agent' }]
  }).join('\n')

  t.regex(out, /UA ~ YisouSpider \(any path\)/)
  t.regex(out, /403/)
})

test('a combined rule shows both halves', t => {
  const out = format_waf({
    enabled: true,
    platform_profiles: [],
    rules: [
      {
        pattern: '^/login',
        user_agent: 'YisouSpider',
        action: 'deny',
        match: 'path_user_agent'
      }
    ]
  }).join('\n')

  t.regex(out, /\^\/login \+ UA ~ YisouSpider/)
})

test('a monitor-probes platform profile does not read like a block', t => {
  const out = format_waf({
    enabled: true,
    platform_profiles: [
      {
        name: 'monitor-probes',
        action: 'probe',
        match: 'user_agent',
        rule_count: 10
      }
    ],
    rules: []
  }).join('\n')

  t.regex(out, /by user-agent/)
  t.notRegex(out, /blocked at the edge/)
})
