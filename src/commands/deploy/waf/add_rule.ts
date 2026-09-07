import { FaableApi } from '../../../api/FaableApi'
import { log } from '../../../log'

/**
 * Shared handler for `block` and `sink` — the two differ only in the action
 * they store and in what the edge answers, so the flow (resolve app, write,
 * explain, tell the user how to check) lives here once.
 */
export const add_rule = async (opts: {
  api: FaableApi
  app_id: string
  app_name: string
  app_url: string
  pattern: string
  action: 'deny' | 'sink'
  description?: string
}) => {
  const { api, app_id, app_name, app_url, pattern, action, description } = opts

  await api.addAppWafRule(app_id, { pattern, action, description })

  const answer = action === 'deny' ? '403' : '404'
  log.info(
    `🛡️  ${pattern} → ${answer} at the edge for ${app_name} (${app_id}).`
  )
  log.info(``)
  log.info(
    action === 'deny'
      ? `Matching requests are blocked before they reach your app, so they no longer wake it.`
      : `Faable answers matching requests with a ${answer} itself, so they no longer wake your app.`
  )
  log.info(``)
  log.info(`It takes about 20s to reach the edge. Then check it with:`)
  log.info(`  curl -s -o /dev/null -w '%{http_code}\\n' https://${app_url}<path>`)
  log.info(``)
  log.info(`Undo: faable deploy waf rm '${pattern}' -a ${app_id}`)
}
