import { FaableDomain } from '../../../api/FaableApi'

// Human summary of a domain's verification state, derived from the DNS
// verification worker's status. Kept pure for tests.
export const dns_badge = (domain: FaableDomain): string => {
  if (domain.verified) return '✅ verified'
  switch (domain.status?.dns_state) {
    case 'ok':
      return '✅ dns ok'
    case 'misconfigured':
      return '❌ misconfigured'
    case 'error':
      return '❌ dns error'
    default:
      return '⏳ pending verification'
  }
}

// The CNAME target the user must configure. The API publishes it in
// `status.dns_expected` (the dashboard shows `<domain.id>.faable.link` — same
// value); fall back to deriving it from the id so `add` can print
// instructions even before the first DNS check populates the status.
export const cname_target = (domain: FaableDomain): string =>
  domain.status?.dns_expected?.[0] ?? `${domain.id}.faable.link`

// The optional record that gets the certificate issued BEFORE the domain
// points here: a domain that is live somewhere else moves without a TLS gap.
// Published by the api in `status.acme_expected`; derived from the id until
// the first check fills it in, like the CNAME above.
export const acme_record = (
  domain: FaableDomain
): { name: string; target: string; ready: boolean } => ({
  name: `_acme-challenge.${domain.fqdn}`,
  target: domain.status?.acme_expected?.[0] ?? `${domain.id}.acme.faable.com`,
  ready: domain.status?.acme_state === 'ok'
})

// The certificate line of `domains check`: what the edge serves today.
export const tls_line = (domain: FaableDomain): string => {
  if (!domain.tls) return 'off (tls: false)'
  if (domain.status?.tls_state === 'ok') {
    const until = domain.status.tls_expires_at?.slice(0, 10)
    return `✅ served${until ? `, valid until ${until}` : ''}`
  }
  return domain.status?.acme_state === 'ok' || domain.status?.dns_state === 'ok'
    ? '⏳ being issued — usually a couple of minutes'
    : '⏳ issued once the CNAME (or the pre-validation record) is in place'
}

export const find_by_fqdn = (
  domains: FaableDomain[],
  fqdn: string
): FaableDomain | undefined =>
  domains.find(d => d.fqdn.toLowerCase() === fqdn.toLowerCase())
