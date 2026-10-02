import { CommandModule } from 'yargs'
import { requireApi } from '../../api/context'
import { requireProject } from '../../api/project'
import { json_option, print, print_json } from '../../lib/listing'
import { log } from '../../log'
import { until } from './inspect/format'

// Project-wide reads: where the project stands today (deploy quota) and this
// billing period (usage). Both answer for the active project (--project,
// FAABLE_PROJECT, `faable project use`, or your only one).

interface ProjectReadArgs {
  json?: boolean
}

// `faable deploy quota` — why a deploy did not start today. A held build is
// waiting for the daily allowance, not failing.
export const quota: CommandModule<unknown, ProjectReadArgs> = {
  command: 'quota',
  describe: "Today's deploy allowance of the project, and builds held by it",
  builder: yargs => json_option(yargs).showHelpOnFail(false) as any,
  handler: async args => {
    const { api } = await requireApi()
    const { id: project } = await requireProject(api)
    const quota = await api.getDeployQuota(project)
    if (args.json) return print_json({ project, ...quota })

    const limit = quota.limit === null ? 'unlimited' : String(quota.limit)
    print(`Deploys today: ${quota.used} of ${limit}`)
    print(`Resets:        ${until(quota.resets_at)} (${quota.resets_at})`)
    if (quota.held > 0) {
      print(`Held:          ${quota.held} build(s) waiting for the allowance`)
    }
    if (quota.over) {
      log.warn(
        '⚠️ The daily allowance is spent: new builds wait until it resets, or upgrade the plan.'
      )
    }
  }
}

interface UsageArgs extends ProjectReadArgs {
  traffic?: boolean
}

type TeamUsage = {
  id: string
  name: string
  period?: { start: string; end: string }
  subscription?: { plan: string | null; status: string } | null
  resources?: { apps: number; domains: number; deployments: number }
  traffic?: { used_gb: number; cost_estimate_cents: number } | null
}

// `faable deploy usage` — this billing period, for the active project. The
// api answers for every project of the caller; the active one is picked out
// (by its id in either form: project_… / team_…).
export const usage: CommandModule<unknown, UsageArgs> = {
  command: 'usage',
  describe:
    "This billing period's usage of the project (apps, deploys, traffic)",
  builder: yargs =>
    json_option(yargs)
      .option('traffic', {
        type: 'boolean',
        default: true,
        description: 'Include egress (the slow part; --no-traffic skips it)'
      })
      .showHelpOnFail(false) as any,
  handler: async args => {
    const { api } = await requireApi()
    const { id: project } = await requireProject(api)
    const summary = (await api.getUsageSummary(project, {
      traffic: args.traffic
    })) as { teams?: TeamUsage[]; billing_available?: boolean }
    const hex = project.replace(/^project_/, '')
    const mine = summary.teams?.find(t => t.id.endsWith(hex)) ?? null
    if (args.json) {
      return print_json({
        project,
        usage: mine,
        billing_available: summary.billing_available ?? null
      })
    }

    if (!mine) {
      log.info(`📭 No usage recorded for ${project} this period.`)
      return
    }
    print(`${mine.name} (${project})`)
    if (mine.period) {
      print(
        `Period:      ${mine.period.start.slice(0, 10)} → ${mine.period.end.slice(0, 10)}`
      )
    }
    if (mine.subscription) {
      print(
        `Plan:        ${mine.subscription.plan ?? 'free'} (${mine.subscription.status})`
      )
    } else if (summary.billing_available === false) {
      // null then means "unknown", not "free".
      print(`Plan:        unknown (billing did not answer)`)
    }
    if (mine.resources) {
      const r = mine.resources
      print(
        `Resources:   ${r.apps} app(s), ${r.domains} domain(s), ${r.deployments} deployment(s)`
      )
    }
    if (mine.traffic) {
      print(`Egress:      ${mine.traffic.used_gb.toFixed(2)} GB`)
    }
  }
}
