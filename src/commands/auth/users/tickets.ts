import { CommandModule } from 'yargs'
import { requireAuthAdmin, withAuthHints } from '../../../api/auth_admin'
import { confirm } from '../../../lib/interactive'
import { log } from '../../../log'
import { TenantArgs, json_option, tenant_options } from '../options'
import { print_json } from '../render'
import { resolve_user_ref } from './resolve'

interface TicketsListArgs extends TenantArgs {
  user: string
}

interface Ticket {
  id: string
  type: string
  status: string
  expires_at?: string
  channel?: string
  link?: string
}

// The reset / verification / invitation tickets issued for a user, newest
// first. Each carries the link that was emailed WHILE it is still usable —
// the way to hand a recovery link over by another channel when the email does
// not reach the person.
const users_tickets_list: CommandModule<unknown, TicketsListArgs> = {
  command: 'list <user>',
  describe: 'List the tickets (reset/verify/invite links) issued for a user',
  builder: yargs =>
    json_option(tenant_options(yargs))
      .positional('user', {
        type: 'string',
        demandOption: true,
        description: 'User id (user_…) or email'
      })
      .showHelpOnFail(false) as any,
  handler: withAuthHints(async args => {
    const api = await requireAuthAdmin(args)
    const user_id = await resolve_user_ref(api, args.user)
    const tickets = (await api
      .userListTickets(user_id)
      .then(r => (r as { results?: Ticket[] }).results ?? [])) as Ticket[]

    if (args.json) return print_json({ user_id, tickets })
    if (tickets.length === 0) {
      log.info('📭 No tickets for this user.')
      return
    }
    log.info(`🎫 ${tickets.length} ticket(s):`)
    for (const t of tickets) {
      log.info(`  ${t.id}  ${t.type}  [${t.status}]${t.expires_at ? ` exp ${t.expires_at}` : ''}`)
      if (t.link) log.info(`     🔗 ${t.link}`)
    }
  })
}

interface TicketsRevokeArgs extends TenantArgs {
  user: string
  ticket_id: string
  yes?: boolean
}

// Revoke a ticket so its link stops working immediately — the counterpart of
// listing links: once a link has been copied out it can end up in the wrong
// window, and the TTL alone is too slow an answer.
const users_tickets_revoke: CommandModule<unknown, TicketsRevokeArgs> = {
  command: 'revoke <user> <ticket_id>',
  describe: 'Revoke a ticket (its link stops working immediately)',
  builder: yargs =>
    json_option(tenant_options(yargs))
      .positional('user', {
        type: 'string',
        demandOption: true,
        description: 'User id (user_…) or email'
      })
      .positional('ticket_id', {
        type: 'string',
        demandOption: true,
        description: 'Ticket id (from `tickets list`)'
      })
      .option('yes', {
        alias: 'y',
        type: 'boolean',
        default: false,
        description: 'Skip the confirmation prompt'
      })
      .showHelpOnFail(false) as any,
  handler: withAuthHints(async args => {
    const api = await requireAuthAdmin(args)
    const user_id = await resolve_user_ref(api, args.user)
    const go = await confirm({
      message: `Revoke ticket ${args.ticket_id} for ${args.user}?`,
      yes: args.yes
    })
    if (!go) {
      log.info('Cancelled.')
      return
    }
    await api.userRevokeTicket(user_id, args.ticket_id)
    if (args.json) return print_json({ user_id, ticket_id: args.ticket_id, revoked: true })
    log.info(`✅ Revoked ticket ${args.ticket_id}.`)
  })
}

export const users_tickets: CommandModule = {
  command: 'tickets',
  describe: 'List or revoke the recovery/verification/invite tickets of a user',
  builder: yargs =>
    yargs
      .command(users_tickets_list)
      .command(users_tickets_revoke)
      .demandCommand(1)
      .showHelpOnFail(false) as any,
  handler: () => {}
}
