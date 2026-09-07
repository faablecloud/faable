import { FaableAppWaf } from '../../../api/FaableApi'

/** Human label for a rule action, so `list` explains itself without docs. */
export const action_label = (action: string): string =>
  action === 'sink'
    ? '404 (answered by Faable, app not woken)'
    : action === 'deny'
      ? '403 (blocked at the edge)'
      : action

/**
 * Render the effective WAF of an app.
 *
 * Platform profiles come back as names + counts for a normal user and with
 * their patterns for an admin, so this prints whatever the server chose to
 * send rather than assuming either shape.
 */
export const format_waf = (waf: FaableAppWaf): string[] => {
  const out: string[] = []

  if (!waf.enabled) {
    out.push('⚠️  WAF disabled for this app — no rule below is enforced.')
    out.push('')
  }

  out.push('Platform rules (managed by Faable):')
  if (waf.platform_profiles.length === 0) {
    out.push('  (none)')
  }
  for (const p of waf.platform_profiles) {
    out.push(`  • ${p.name} — ${p.rule_count} rule(s), ${action_label(p.action)}`)
    for (const r of p.rules ?? []) {
      out.push(`      ${r.pattern}${r.description ? `  # ${r.description}` : ''}`)
    }
  }

  out.push('')
  out.push('Your rules:')
  if (waf.rules.length === 0) {
    out.push('  (none)')
  }
  for (const r of waf.rules) {
    out.push(`  • ${r.pattern} → ${action_label(r.action)}`)
    if (r.description) out.push(`      ${r.description}`)
  }

  return out
}
