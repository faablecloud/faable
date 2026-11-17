import { BlockList, isIP } from 'node:net'
import { FaableApi, FaableAppWaf, FaableWafRule } from '../../../api/FaableApi'
import { log } from '../../../log'
import { example_path, limit_label } from './format'

export type RuleSelector = {
  pattern?: string
  user_agent?: string
  query?: string
  /** One address or CIDR, e.g. 203.0.113.7 or 203.0.113.0/24. */
  ip?: string
}

/**
 * The selector flags a `block` / `sink` / `monitor` takes, checked the way the
 * api checks them, so a combination the server refuses is refused here with
 * the same words — before anything is resolved or written.
 */
export const check_selector = (
  verb: string,
  a: { pattern?: string; userAgent?: string; query?: string; ip?: string }
): true => {
  if (a.ip && (a.userAgent || a.query)) {
    throw new Error(
      'An IP rule can be combined with a path, not with a user-agent or a query parameter.'
    )
  }
  if (a.userAgent && a.query) {
    throw new Error(
      'A rule can combine a path with --user-agent OR with --query, not both.'
    )
  }
  if (!a.pattern && !a.userAgent && !a.query && !a.ip) {
    throw new Error(
      'Give a path pattern, --user-agent, --query, --ip, or a path with one of them.\n' +
        `  e.g. faable deploy waf ${verb} '^/wp-admin'\n` +
        `       faable deploy waf ${verb} --user-agent YisouSpider\n` +
        `       faable deploy waf ${verb} --query rest_route\n` +
        `       faable deploy waf ${verb} --ip 203.0.113.7`
    )
  }
  return true
}

/**
 * `allow` and `limit` have no `--ip`. The CLI does not refuse unknown flags,
 * so without this `limit '^/api' --ip x` would quietly limit /api for every
 * client — and `allow` would open a platform-blocked path to everyone.
 */
export const refuse_ip = (action: 'allow' | 'limit', ip: unknown): true => {
  if (ip !== undefined) {
    throw new Error(
      action === 'allow'
        ? 'An allow rule is a path pattern only (no IP).'
        : 'A limit rule cannot target an IP. Use block or sink to stop that IP, or a limit per IP on a path.'
    )
  }
  return true
}

/** The `--ip` option, the same on every command that takes it. */
export const IP_OPTION = {
  type: 'string',
  description:
    'Client IP or CIDR, e.g. 203.0.113.7 or 203.0.113.0/24 (at most a /16, or a /48 for IPv6). ' +
    'Matched against the connecting address, never X-Forwarded-For. With a path, BOTH must match.'
} as const

/** How a rule reads in a sentence, for the confirmation the user gets back. */
export const describe_selector = (s: RuleSelector): string => {
  if (s.pattern && s.user_agent) {
    return `requests for ${s.pattern} from user-agents matching ${s.user_agent}`
  }
  if (s.pattern && s.query) {
    return `requests for ${s.pattern} carrying ?${s.query}`
  }
  if (s.pattern && s.ip) return `requests for ${s.pattern} from ${s.ip}`
  if (s.ip) return `requests from ${s.ip}`
  if (s.user_agent) return `requests from user-agents matching ${s.user_agent}`
  if (s.query) return `requests carrying ?${s.query}`
  return `requests for ${s.pattern}`
}

/**
 * Is `stored` (as the server normalized it) the network the user typed?
 *
 * The server clears host bits, drops `/32` and `/128` and lowercases and
 * compresses IPv6, so a string compare would call `203.0.113.7/24` (stored as
 * `203.0.113.0/24`) a dropped field and undo a good rule. Same family, same
 * prefix length, and the typed address inside the stored network is the same
 * network.
 */
export const same_ip = (stored?: string, wanted?: string): boolean => {
  if (!stored || !wanted) return !stored && !wanted
  const parse = (s: string) => {
    const [addr, len, extra] = s.trim().split('/')
    const family = isIP(addr)
    if (!family || extra !== undefined) return null
    const max = family === 4 ? 32 : 128
    const prefix = len === undefined ? max : Number(len)
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > max) return null
    return { addr, type: family === 4 ? 'ipv4' : 'ipv6', prefix } as const
  }
  const a = parse(stored)
  const b = parse(wanted)
  if (!a || !b)
    return stored.trim().toLowerCase() === wanted.trim().toLowerCase()
  if (a.type !== b.type || a.prefix !== b.prefix) return false
  const net = new BlockList()
  net.addSubnet(a.addr, a.prefix, a.type)
  return net.check(b.addr, b.type)
}

/** Does this returned rule carry everything we asked for? */
export const rule_matches_request = (
  rule: FaableWafRule,
  want: RuleSelector,
  action: string
): boolean =>
  rule.action === action &&
  (rule.pattern ?? '') === (want.pattern ?? '') &&
  (rule.user_agent ?? '') === (want.user_agent ?? '') &&
  (rule.query ?? '') === (want.query ?? '') &&
  same_ip(rule.client_ip, want.ip)

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
  query?: string
  ip?: string
  action: 'deny' | 'sink' | 'allow' | 'monitor' | 'limit'
  description?: string
  force?: boolean
  /** Only for 'limit'. */
  rate?: { average: number; period: '1s' | '1m'; burst?: number }
  per?: 'ip' | 'rule'
  // --json: the WAF as it is after the write, and no prose.
  json?: boolean
}): Promise<FaableAppWaf> => {
  const {
    api,
    app_id,
    app_name,
    app_url,
    pattern,
    user_agent,
    query,
    ip,
    action,
    description,
    force,
    json,
    rate,
    per
  } = opts

  const want: RuleSelector = { pattern, user_agent, query, ip }
  const waf = await api.addAppWafRule(app_id, {
    pattern,
    user_agent,
    query,
    ...(ip ? { client_ip: ip } : {}),
    action,
    description,
    force,
    ...(action === 'limit' ? { rate, per } : {})
  })

  // Read the rule back before telling the user it worked.
  //
  // An older Faable server has no `user_agent` (or no `query`) on this endpoint
  // and drops it silently, storing the path half on its own — which turns
  // "block /login for this bot" into "block /login for everyone", or "block /
  // when it carries ?rest_route" into "block /", which is the entire app. No
  // server-side schema can prevent that (the old server is the old code), so
  // the client checks that what came back is what it asked for, and undoes the
  // write if it is not.
  //
  // The query half is the more dangerous of the two, because the api LIFTS the
  // site-root guard for a path that is ANDed with a parameter: `^/$` is a legal
  // pattern to send, and an old server that drops the parameter stores exactly
  // the rule the guard exists to refuse.
  //
  // The IP half is the same danger again: `^/$` with an ip is legal without
  // --force, and a server that drops the ip stores "every visitor of the site
  // root". An ip-only rule on such a server is refused outright (no selector
  // left), but the readback catches it too.
  if (
    (user_agent || query || ip) &&
    !waf.rules.some(r => rule_matches_request(r, want, action))
  ) {
    await api
      .removeAppWafRule(app_id, {
        pattern,
        user_agent,
        query,
        ...(ip ? { client_ip: ip } : {}),
        action
      })
      // If the rollback itself is unsupported, fall back to the path-only
      // shape the old server actually stored.
      .catch(() => api.removeAppWafRule(app_id, { pattern, action }))
      .catch(() => undefined)
    throw new Error(
      `This Faable server does not support ${ip ? 'IP' : query ? 'query-parameter' : 'user-agent'} rules yet, so the rule was not created.\n` +
        `  Update the CLI and try again, or ask support to upgrade the platform.`
    )
  }

  if (json) return waf

  // Say it, and undo it, the way the server stored it: `1.2.3.4/32` is kept
  // as `1.2.3.4`, and that is what `waf list` shows and `rm` is given.
  if (ip) {
    want.ip =
      waf.rules.find(r => rule_matches_request(r, want, action))?.client_ip ??
      ip
  }

  if (action === 'limit') {
    const stored = waf.rules.find(r => rule_matches_request(r, want, 'limit'))
    const label = stored?.rate
      ? limit_label(stored.rate, stored.per)
      : 'rate limited'
    log.info(`⏱️  ${describe_selector(want)} → ${label}`)
    log.info(`   for ${app_name} (${app_id}).`)
    log.info(``)
    log.info(
      `Over the limit, Faable answers 429 at the edge: those requests do not reach or wake your app.`
    )
    if (stored?.per === 'rule') {
      log.info(
        `The count is shared by every client of each of the app's domains, not kept per IP.`
      )
    }
    if (user_agent && !pattern) {
      log.info(``)
      log.info(
        `⚠️  A user-agent rule has no path restriction: it counts every request from that client.`
      )
    }
    log.info(``)
    log.info(`It takes about 20s to reach the edge. Then check it with:`)
    log.info(
      `  for i in $(seq 1 ${(stored?.rate?.burst ?? 10) + 5}); do curl -s -o /dev/null -w '%{http_code} ' ${user_agent ? `-A '${user_agent}' ` : ''}'https://${app_url}${example_path(pattern, query)}'; done; echo`
    )
    log.info(``)
    log.info(
      `Undo: faable deploy waf rm ${undo_args(want)} --action limit -a ${app_id}`
    )
    return waf
  }

  if (action === 'allow') {
    // The one rule that opens instead of closing: say exactly what it opens.
    log.info(`🔓 ${describe_selector(want)} → reaches your app`)
    log.info(
      `   for ${app_name} (${app_id}), even where Faable blocks it for every app`
    )
    log.info(`   (archives like .zip or .tar.gz, dotfiles, config files).`)
    log.info(``)
    log.info(
      `Your own block and sink rules still win over it, and certificate checks,`
    )
    log.info(`/.faable/* and /_next/* are never affected.`)
    log.info(``)
    log.info(`It takes about 20s to reach the edge. Then check it with:`)
    log.info(
      `  curl -s -o /dev/null -w '%{http_code}\\n' https://${app_url}<path>`
    )
    log.info(``)
    log.info(
      `Undo: faable deploy waf rm ${undo_args(want)} --action allow -a ${app_id}`
    )
    return waf
  }

  if (action === 'monitor') {
    log.info(`👀 ${describe_selector(want)} → monitor only, nothing is blocked`)
    log.info(`   for ${app_name} (${app_id}).`)
    log.info(``)
    // It reads the past: the rule is checked against traffic already served,
    // so its first answer is the last week, not a week from now.
    const now = Math.floor(Date.now() / 1000)
    const seen = await api
      .appWafWouldBlock(app_id, now - 7 * 86400, now)
      .catch(() => undefined)
    const legend = seen?.rules ?? []
    const id = legend.find(r =>
      rule_matches_request(r as any, want, 'monitor')
    )?.id
    const n = id
      ? (seen?.would_block?.top_rules.find(r => r.rule === id)?.requests ?? 0)
      : undefined
    if (n !== undefined) {
      log.info(
        n === 0
          ? `In the last 7 days it would have stopped nothing.`
          : `In the last 7 days it would have stopped ${n.toLocaleString()} request${n === 1 ? '' : 's'} your app served.`
      )
    }
    log.info(
      `The Firewall tab of the app shows what it would stop, request by request.`
    )
    log.info(``)
    log.info(
      `When it only catches what it should: faable deploy waf block ${undo_args(want)} -a ${app_id}`
    )
    log.info(
      `Undo: faable deploy waf rm ${undo_args(want)} --action monitor -a ${app_id}`
    )
    return waf
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
  if (ip) {
    log.info(``)
    if (!pattern) {
      log.info(
        `⚠️  An IP rule with no path applies to EVERY path on this app, for that address.`
      )
    }
    log.info(
      `   It matches the connecting address, never X-Forwarded-For. If a custom domain`
    )
    log.info(
      `   is behind your own proxy (e.g. Cloudflare's orange cloud), that address is the`
    )
    log.info(`   proxy's, and blocking it blocks part of every visitor.`)
  }
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
      : ip
        ? `  curl -s -o /dev/null -w '%{http_code}\\n' https://${app_url}${example_path(pattern)}   # from ${want.ip}`
        : `  curl -s -o /dev/null -w '%{http_code}\\n' https://${app_url}<path>`
  )
  log.info(``)
  log.info(`Undo: faable deploy waf rm ${undo_args(want)} -a ${app_id}`)
  return waf
}

/** The exact arguments that reverse this rule. */
export const undo_args = (s: RuleSelector): string =>
  [
    s.pattern ? `'${s.pattern}'` : '',
    s.user_agent ? `--user-agent '${s.user_agent}'` : '',
    s.query ? `--query '${s.query}'` : '',
    s.ip ? `--ip '${s.ip}'` : ''
  ]
    .filter(Boolean)
    .join(' ')
