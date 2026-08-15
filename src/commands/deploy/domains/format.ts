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

export const find_by_fqdn = (
  domains: FaableDomain[],
  fqdn: string
): FaableDomain | undefined =>
  domains.find(d => d.fqdn.toLowerCase() === fqdn.toLowerCase())
