import { FaableApi, FaableWafRule } from '../../../api/FaableApi'
import { log } from '../../../log'

export type RuleSelector = {
  pattern?: string
  user_agent?: string
}

/** How a rule reads in a sentence, for the confirmation the user gets back. */
export const describe_selector = (s: RuleSelector): string => {
  if (s.pattern && s.user_agent) {
    return `requests for ${s.pattern} from user-agents matching ${s.user_agent}`
  }
  if (s.user_agent) return `requests from user-agents matching ${s.user_agent}`
  return `requests for ${s.pattern}`
}

/** Does this returned rule carry everything we asked for? */
export const rule_matches_request = (
  rule: FaableWafRule,
  want: RuleSelector,
  action: string
): boolean =>
  rule.action === action &&
  (rule.pattern ?? '') === (want.pattern ?? '') &&
  (rule.user_agent ?? '') === (want.user_agent ?? '')

/**
 * Shared handler for `block` and `sink` — the two differ only in the action
 * they store and in what the edge answers, so the flow (resolve app, write,
 * verify, explain, tell the user how to check) lives here once.
 */
export const add_rule = async (opts: {
  api: FaableApi
  app_id: string
  app_name: string
  app_url: string
  pattern?: string
  user_agent?: string
  action: 'deny' | 'sink'
  description?: string
  force?: boolean
}) => {
  const {
    api,
    app_id,
    app_name,
    app_url,
    pattern,
    user_agent,
    action,
    description,
    force
  } = opts

  const want: RuleSelector = { pattern, user_agent }
  const waf = await api.addAppWafRule(app_id, {
    pattern,
    user_agent,
    action,
    description,
    force
  })

  // Read the rule back before telling the user it worked.
  //
  // An older Faable server has no `user_agent` on this endpoint and drops it
  // silently, storing the path half on its own — which turns "block /login for
  // this bot" into "block /login for everyone". No server-side schema can
  // prevent that (the old server is the old code), so the client checks that
  // what came back is what it asked for, and undoes the write if it is not.
  if (
    user_agent &&
    !waf.rules.some(r => rule_matches_request(r, want, action))
  ) {
    await api
      .removeAppWafRule(app_id, { pattern, user_agent, action })
      // If the rollback itself is unsupported, fall back to the path-only
      // shape the old server actually stored.
      .catch(() => api.removeAppWafRule(app_id, { pattern, action }))
      .catch(() => undefined)
    throw new Error(
      `This Faable server does not support user-agent rules yet, so the rule was not created.\n` +
        `  Update the CLI and try again, or ask support to upgrade the platform.`
    )
  }

  const answer = action === 'deny' ? '403' : '404'
  log.info(`🛡️  ${describe_selector(want)} → ${answer} at the edge`)
  log.info(`   for ${app_name} (${app_id}).`)
  log.info(``)
  log.info(
    action === 'deny'
      ? `Matching requests are blocked before they reach your app, so they no longer wake it.`
      : `Faable answers matching requests with a ${answer} itself, so they no longer wake your app.`
  )
  if (user_agent) {
    log.info(``)
    log.info(
      `⚠️  A user-agent rule has no path restriction: it applies to EVERY path` +
        (pattern ? ` that also matches ${pattern}.` : ` on this app.`)
    )
    if (action === 'sink' && !pattern) {
      // Worth saying out loud: the sink router sits above the sleep-through
      // probe, so a monitor caught by this rule gets the 404 instead of the
      // health answer it expects.
      log.info(
        `   If that user-agent is an uptime monitor, it will now see a 404 instead of a health check.`
      )
    }
  }
  log.info(``)
  log.info(`It takes about 20s to reach the edge. Then check it with:`)
  log.info(
    user_agent
      ? `  curl -s -o /dev/null -w '%{http_code}\\n' -A '${user_agent}' https://${app_url}/`
      : `  curl -s -o /dev/null -w '%{http_code}\\n' https://${app_url}<path>`
  )
  log.info(``)
  log.info(`Undo: faable deploy waf rm ${undo_args(want)} -a ${app_id}`)
}

/** The exact arguments that reverse this rule. */
export const undo_args = (s: RuleSelector): string =>
  [
    s.pattern ? `'${s.pattern}'` : '',
    s.user_agent ? `--user-agent '${s.user_agent}'` : ''
  ]
    .filter(Boolean)
    .join(' ')
