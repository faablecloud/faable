import test from 'ava'
import { FaableDomain } from '../../../api/FaableApi'
import { cname_target, dns_badge, find_by_fqdn } from './format'

const domain = (over: Partial<FaableDomain> = {}): FaableDomain => ({
  id: 'domain_abc123',
  fqdn: 'www.example.com',
  tls: true,
  verified: false,
  active: true,
  team: 'team_1',
  ...over
})

test('dns_badge: verified wins over any dns state', t => {
  t.is(
    dns_badge(domain({ verified: true, status: { dns_state: 'error' } })),
    '✅ verified'
  )
})

test('dns_badge: maps worker states', t => {
  t.is(dns_badge(domain({ status: { dns_state: 'ok' } })), '✅ dns ok')
  t.is(
    dns_badge(domain({ status: { dns_state: 'misconfigured' } })),
    '❌ misconfigured'
  )
  t.is(dns_badge(domain({ status: { dns_state: 'error' } })), '❌ dns error')
  t.is(dns_badge(domain()), '⏳ pending verification')
  t.is(
    dns_badge(domain({ status: { dns_state: 'pending' } })),
    '⏳ pending verification'
  )
})

test('cname_target: prefers the API-published expected target', t => {
  t.is(
    cname_target(
      domain({ status: { dns_expected: ['custom.faable.link'] } })
    ),
    'custom.faable.link'
  )
  // Freshly created domain, worker has not checked yet → derived from id.
  t.is(cname_target(domain()), 'domain_abc123.faable.link')
})

test('find_by_fqdn is case-insensitive', t => {
  const list = [domain(), domain({ id: 'domain_x', fqdn: 'api.example.com' })]
  t.is(find_by_fqdn(list, 'API.example.COM')?.id, 'domain_x')
  t.is(find_by_fqdn(list, 'missing.example.com'), undefined)
})
