import { FaableAppWaf, FaableWafRule } from '../../../api/FaableApi'

/** Human label for a rule action, so `list` explains itself without docs. */
export const action_label = (action: string): string =>
  action === 'sink'
    ? '404 (answered by Faable, app not woken)'
    : action === 'deny'
      ? '403 (blocked at the edge)'
      : action === 'probe'
        ? 'answered by Faable, app not woken (uptime monitors)'
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
    // Say what the ruleset matches ON, not just what it answers: without it a
    // `probe` profile of user-agents reads as if it blocked paths.
    const on =
      p.match === 'user_agent'
        ? ' by user-agent'
        : p.match === 'query'
          ? ' by query parameter'
          : ''
    out.push(
      `  • ${p.name} — ${p.rule_count} rule(s)${on}, ${action_label(p.action)}`
    )
    for (const r of p.rules ?? []) {
      const what =
        p.match === 'user_agent'
          ? `UA ~ ${r.pattern}`
          : p.match === 'query'
            ? `?${r.pattern}`
            : r.pattern
      out.push(`      ${what}${r.description ? `  # ${r.description}` : ''}`)
    }
  }

  out.push('')
  out.push('Your rules:')
  if (waf.rules.length === 0) {
    out.push('  (none)')
  }
  for (const r of waf.rules) {
    out.push(`  • ${rule_subject(r)} → ${action_label(r.action)}`)
    if (r.description) out.push(`      ${r.description}`)
  }

  return out
}

/**
 * What a rule selects, in one line.
 *
 * The five shapes have to be visibly different here: a user-agent or query rule
 * has no path restriction (it applies to the whole app) and the combined ones
 * are ANDs, so printing any of them as a bare pattern would misrepresent its
 * reach. The `?` prefix marks a query parameter — `rest_route` on its own would
 * read like a path.
 */
export const rule_subject = (r: FaableWafRule): string => {
  if (r.pattern && r.user_agent) {
    return `${r.pattern} + UA ~ ${r.user_agent}`
  }
  if (r.pattern && r.query) return `${r.pattern} + ?${r.query}`
  if (r.user_agent) return `UA ~ ${r.user_agent} (any path)`
  if (r.query) return `?${r.query} (any path)`
  return r.pattern ?? '(unknown)'
}
