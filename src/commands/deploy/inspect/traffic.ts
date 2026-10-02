import { CommandModule } from 'yargs'
import { requireApi } from '../../../api/context'
import { CliError } from '../../../lib/errors'
import {
  json_option,
  print,
  print_json,
  table_lines
} from '../../../lib/listing'
import { log } from '../../../log'
import { resolve_app_id } from '../resolve_app_id'

interface TrafficArgs {
  app?: string
  since?: string
  deployment?: string
  json?: boolean
}

type Traffic = {
  range?: { from: number; to: number; interval: number }
  top_endpoints?: { path: string; requests: number; resp_bytes: number }[]
  error_endpoints?: { path: string; status: number; errors: number }[]
  status_codes?: { status: number; requests: number }[]
  // Panels whose query failed: what follows is partial, not zero.
  degraded?: string[]
}

const UNITS: Record<string, number> = { m: 60, h: 3600, d: 86400 }

// "24h", "7d", "30m" → seconds. The api keeps about a month of edge logs.
export const parse_since = (since: string): number => {
  const m = /^(\d+)([mhd])$/.exec(since.trim())
  if (!m || Number(m[1]) < 1) {
    throw new CliError(
      'usage',
      `--since takes a duration like 30m, 24h or 7d (got "${since}")`
    )
  }
  return Number(m[1]) * UNITS[m[2]]
}

// `faable deploy traffic` — what the edge saw for the app: busiest paths,
// failing paths and status codes. Trails reality by up to 15 minutes.
export const traffic: CommandModule<unknown, TrafficArgs> = {
  command: 'traffic',
  describe: 'Requests the app served: top paths, errors and status codes',
  builder: yargs =>
    json_option(yargs)
      .option('app', {
        alias: 'a',
        type: 'string',
        description: 'App id, name or slug (defaults to the linked app)'
      })
      .option('since', {
        type: 'string',
        default: '24h',
        description: 'How far back: 30m, 24h, 7d…'
      })
      .option('deployment', {
        alias: 'd',
        type: 'string',
        description: 'Only the traffic one deployment served'
      })
      .example('$0 deploy traffic', 'The last 24h of the linked app')
      .example(
        '$0 deploy traffic --since 7d -a my-app',
        'A week of another app'
      )
      .showHelpOnFail(false) as any,
  handler: async args => {
    const seconds = parse_since(args.since ?? '24h')
    const ctx = await requireApi()
    const app_id = await resolve_app_id(args.app, ctx.appId, ctx.api)
    const app = await ctx.api.getApp(app_id)
    const to = Math.floor(Date.now() / 1000)
    const data = (await ctx.api.getAppTraffic(app_id, app.team, {
      from: to - seconds,
      to,
      ...(args.deployment ? { deployment_id: args.deployment } : {})
    })) as Traffic
    if (args.json) return print_json({ app_id, ...data })

    const total = (data.status_codes ?? []).reduce((n, s) => n + s.requests, 0)
    log.info(`📈 ${app.name} — last ${args.since}: ${total} request(s)`)
    if (data.degraded?.length) {
      log.warn(
        `⚠️ Partial: ${data.degraded.join(', ')} could not be read — those are missing, not zero.`
      )
    }
    if (total === 0) return

    print('')
    print('Status codes')
    for (const line of table_lines(
      ['  STATUS', 'REQUESTS'],
      (data.status_codes ?? []).map(s => [`  ${s.status}`, String(s.requests)])
    )) {
      print(line)
    }
    if (data.top_endpoints?.length) {
      print('')
      print('Top paths')
      for (const line of table_lines(
        ['  REQUESTS', 'PATH'],
        data.top_endpoints.slice(0, 10).map(e => [`  ${e.requests}`, e.path])
      )) {
        print(line)
      }
    }
    if (data.error_endpoints?.length) {
      print('')
      print('Failing paths')
      for (const line of table_lines(
        ['  ERRORS', 'STATUS', 'PATH'],
        data.error_endpoints
          .slice(0, 10)
          .map(e => [`  ${e.errors}`, String(e.status), e.path])
      )) {
        print(line)
      }
    }
  }
}
