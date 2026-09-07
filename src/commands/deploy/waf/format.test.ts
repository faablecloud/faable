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
