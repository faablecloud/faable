import { CommandModule } from 'yargs'
import { requireSessionToken } from '../../../api/auth_admin'
import { FaableApi } from '../../../api/FaableApi'
import { requireProject } from '../../../api/project'
import { bearer_strategy } from '../../../api/strategies/bearer.strategy'
import { ContextStore } from '../../../lib/ContextStore'
import {
  ListArgs,
  fetch_page,
  list_options,
  more_hint,
  print,
  print_json,
  table_lines
} from '../../../lib/listing'
import { log } from '../../../log'

const deploy_api = async () =>
  FaableApi.create({
    authStrategy: bearer_strategy,
    auth: { token: await requireSessionToken() }
  })

// `faable auth accounts list` — the Auth tenants of the active project, the
// ones `faable auth` can manage without --account.
const accounts_list: CommandModule<unknown, ListArgs> = {
  command: 'list',
  describe: "List the active project's Auth tenants",
  builder: yargs => list_options(yargs).showHelpOnFail(false) as any,
  handler: async args => {
    const api = await deploy_api()
    const project = await requireProject(api)
    const page = await fetch_page(
      p => api.listProjectAuthAccounts(project.id, p),
      args
    )
    if (args.json) return print_json(page)

    if (page.data.length === 0) {
      log.info(`📭 Project ${project.id} has no Auth tenants.`)
      return
    }
    const stored = (await new ContextStore().load()).auth_accounts?.[project.id]
    const active = page.data.length === 1 ? page.data[0].id : stored
    log.info(`🔐 ${page.data.length} Auth tenant(s) in ${project.id}:`)
    for (const line of table_lines(
      ['', 'ID', 'NAME', 'DOMAIN'],
      page.data.map(a => [a.id === active ? '*' : '', a.id, a.name, a.domain])
    )) {
      print(line)
    }
    const hint = more_hint(page)
    if (hint) log.info(hint)
  }
}

export const accounts: CommandModule = {
  command: 'accounts',
  describe: "The active project's Auth tenants",
  builder: yargs =>
    yargs.command(accounts_list).demandCommand(1).showHelpOnFail(false) as any,
  handler: () => {}
}

// `faable auth use <account_id>` — which tenant `faable auth` manages in the
// active project, for a project with more than one.
export const auth_use: CommandModule<unknown, { account: string }> = {
  command: 'use <account>',
  describe: 'Set the Auth tenant to manage in the active project',
  builder: yargs =>
    yargs
      .positional('account', { type: 'string', demandOption: true })
      .showHelpOnFail(false) as any,
  handler: async args => {
    const api = await deploy_api()
    const project = await requireProject(api)
    const { results } = await api.listProjectAuthAccounts(project.id, {
      pageSize: 200
    })
    const wanted = args.account.toLowerCase()
    const account = results.find(
      a =>
        a.id === args.account ||
        a.slug?.toLowerCase() === wanted ||
        a.domain.toLowerCase() === wanted
    )
    if (!account) {
      const list = results.map(a => `${a.name} (${a.id})`).join(', ') || 'none'
      throw new Error(
        `${args.account} is not an Auth tenant of ${project.id}. Its tenants: ${list}.`
      )
    }
    await new ContextStore().update(ctx => ({
      ...ctx,
      auth_accounts: { ...ctx.auth_accounts, [project.id]: account.id }
    }))
    log.info(`✅ faable auth now manages ${account.name} (${account.domain}) in ${project.id}.`)
  }
}
