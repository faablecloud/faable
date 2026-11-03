import { CommandModule } from 'yargs'
import { requireAuthAdmin, withAuthHints } from '../../../api/auth_admin'
import { fetch_page, from_paginator } from '../../../lib/listing'
import { log } from '../../../log'
import { TenantArgs, json_option, tenant_options } from '../options'
import { print_json } from '../render'

interface DiagnoseArgs extends TenantArgs {
  identifier: string
}

type Cred = {
  id: string
  connection?: string
  email?: string
  username?: string
  user?: string | { id?: string; email?: string }
}

const user_of = (c: Cred): { id?: string; email?: string } =>
  typeof c.user === 'string' ? { id: c.user } : (c.user ?? {})

// Answers "why can't X log in?" from the identifier the person typed. The
// password login matches a CREDENTIAL identifier, not the profile email, so a
// login can fail for a reason get_auth_user alone does not show: the address
// they were given is simply not one any account logs in with. This resolves
// that in one call.
export const users_diagnose: CommandModule<unknown, DiagnoseArgs> = {
  command: 'diagnose <identifier>',
  describe: 'Explain why an email/username someone typed does (or does not) log in',
  builder: yargs =>
    json_option(tenant_options(yargs))
      .positional('identifier', {
        type: 'string',
        demandOption: true,
        description: 'The email or username the person is trying to log in with'
      })
      .example(
        '$0 auth users diagnose jtamargo@med.ucm.es',
        'Check whether that identifier logs in, and if not, what the account actually uses'
      )
      .showHelpOnFail(false) as any,
  handler: withAuthHints(async args => {
    const api = await requireAuthAdmin(args)
    const id = args.identifier.trim()
    const as_email = id.includes('@')
    const needle = as_email ? id.toLowerCase() : id

    const first = async (params: Record<string, unknown>): Promise<Cred[]> =>
      fetch_page(from_paginator(api.credentialsList(params as never)), { limit: 20 })
        .then(r => r.data as Cred[])
        .catch(() => [])

    // 1. Exact: does any database credential log in with this identifier?
    const matches = await first({
      ...(as_email ? { email: needle } : { username: needle }),
      expand: ['user']
    })

    // 2. If not, is it a user's PROFILE email while they log in with another
    //    identifier? (the trap: a right-looking email that is not the login.)
    const profile_users = matches.length === 0 && as_email
      ? await fetch_page(from_paginator(api.userList({ email: needle } as never)), {
          limit: 5
        })
          .then(r => r.data as Array<{ id: string; email?: string }>)
          .catch(() => [])
      : []
    const alt_creds: Record<string, Cred[]> = {}
    for (const u of profile_users) {
      alt_creds[u.id] = await first({ user: u.id })
    }

    // 3. Fuzzy suggestions when nothing matched at all.
    const suggestions =
      matches.length === 0 && profile_users.length === 0
        ? await first({ q: as_email ? id.split('@')[0] : id })
        : []

    if (args.json) {
      return print_json({
        identifier: id,
        logs_in: matches.length > 0,
        matches: matches.map(c => ({
          credential: c.id,
          connection: c.connection,
          identifier: c.email ?? c.username,
          user: user_of(c)
        })),
        profile_email_only: profile_users.map(u => ({
          user: u.id,
          email: u.email,
          login_identifiers: (alt_creds[u.id] ?? []).map(c => c.email ?? c.username)
        })),
        suggestions: suggestions.map(c => c.email ?? c.username).filter(Boolean)
      })
    }

    log.info(`🔎 Diagnosing login for: ${id}`)
    if (matches.length > 0) {
      log.info('✅ This IS a login identifier. It signs in as:')
      for (const c of matches) {
        const u = user_of(c)
        log.info(`   ${u.email ?? u.id ?? '-'} (${u.id ?? '-'}) · connection ${c.connection ?? '-'}`)
      }
      log.info('   If login still fails, it is the password or a suspension — not the identifier.')
      log.info('   Set a password: faable auth users set-password <user> --generate')
      return
    }

    log.info(`❌ No account logs in with ${id}.`)
    if (profile_users.length > 0) {
      log.info('⚠️  But a user has it as their PROFILE email — they must log in with their identifier:')
      for (const u of profile_users) {
        const ids = (alt_creds[u.id] ?? []).map(c => c.email ?? c.username).filter(Boolean)
        log.info(`   ${u.email} → logs in with: ${ids.length ? ids.join(', ') : '(no database credential)'}`)
      }
      log.info('   Fix: tell them that identifier, or move it with: faable auth users update <user> --email ' + id)
      return
    }
    if (suggestions.length > 0) {
      log.info('   Did you mean one of these login identifiers?')
      for (const c of suggestions.slice(0, 5)) {
        log.info(`   - ${c.email ?? c.username} (${user_of(c).email ?? user_of(c).id ?? '-'})`)
      }
    } else {
      log.info('   No similar identifier found in this tenant.')
    }
  })
}
