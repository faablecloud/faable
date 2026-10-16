import test from 'ava'
import { FaableDomain } from '../../../api/FaableApi'
import {
  acme_record,
  cname_target,
  dns_badge,
  find_by_fqdn,
  tls_line
} from './format'

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
    cname_target(domain({ status: { dns_expected: ['custom.faable.link'] } })),
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

// F6 (arch/deploy/cli-mcp-fallos-2026-10-16-plan.md): the record that gets the
// certificate issued before the domain points here.
test('acme_record: the record to create, and whether it is in place', t => {
  t.deepEqual(acme_record(domain()), {
    name: '_acme-challenge.www.example.com',
    target: 'domain_abc123.acme.faable.com',
    ready: false
  })
  t.deepEqual(
    acme_record(
      domain({
        status: { acme_state: 'ok', acme_expected: ['custom.acme.faable.com'] }
      })
    ),
    {
      name: '_acme-challenge.www.example.com',
      target: 'custom.acme.faable.com',
      ready: true
    }
  )
})

// F7: what the edge serves, so nobody has to probe it with curl to know when
// the certificate is there.
test('tls_line: served with its expiry, being issued, or waiting for DNS', t => {
  t.is(
    tls_line(
      domain({
        status: { tls_state: 'ok', tls_expires_at: '2027-01-14T12:48:27.000Z' }
      })
    ),
    '✅ served, valid until 2027-01-14'
  )
  t.regex(
    tls_line(domain({ status: { acme_state: 'ok', tls_state: 'pending' } })),
    /being issued/
  )
  t.regex(tls_line(domain({ status: { dns_state: 'pending' } })), /issued once/)
  t.is(tls_line(domain({ tls: false })), 'off (tls: false)')
})
