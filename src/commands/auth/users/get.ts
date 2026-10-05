import { CommandModule } from 'yargs'
import { requireAuthAdmin, withAuthHints } from '../../../api/auth_admin'
import { log } from '../../../log'
import { TenantArgs, json_option, tenant_options } from '../options'
import { fetch_page, from_paginator } from '../../../lib/listing'
import { print_json, when, yes_no } from '../render'
import { resolve_user_ref } from './resolve'

interface UsersGetArgs extends TenantArgs {
  user_id: string
}

// Identity rows carry the RAW provider access/refresh tokens — strip them
// before anything (json output included) can print one.
const sanitize_identity = (i: Record<string, unknown>) => {
  const {
    access_token: _a,
    access_token_secret: _s,
    refresh_token: _r,
    ...safe
  } = i
  return safe
}

type ProfileData = {
  login?: string
  html_url?: string
  created_at?: string
  email?: string
  location?: string
  followers?: number
}

export const users_get: CommandModule<unknown, UsersGetArgs> = {
  command: 'get <user_id>',
  describe: 'Show a user (by id or email), including their federated identities',
  builder: yargs =>
    json_option(tenant_options(yargs))
      .positional('user_id', {
        type: 'string',
        demandOption: true,
        description: 'User id (user_…) or email'
      })
      .showHelpOnFail(false) as any,
  handler: withAuthHints(async args => {
    const api = await requireAuthAdmin(args)
    const user_id = await resolve_user_ref(api, args.user_id)
    const user = await api.userGet(user_id)

    // Federated identities (GitHub, Google…): who this user IS at the
    // provider — the piece the abuse playbook keeps needing (a Faable email
    // rarely matches the GitHub handle that owns the deployed repos).
    // Best-effort: a tenant where the session can't read /identity still
    // renders the user card.
    const identities = await fetch_page(
      from_paginator(api.identityList({ query: `user:${user_id}` })),
      { limit: 200, all: true }
    )
      .then(r => r.data.map(i => sanitize_identity(i as never)))
      .catch(() => [] as Record<string, unknown>[])

    // Resolve connection ids to names ("github") once per distinct id.
    const connection_names = new Map<string, string>()
    for (const id of new Set(
      identities.map(i => String(i.connection ?? '')).filter(Boolean)
    )) {
      const conn = (await api.connectionGet(id).catch(() => null)) as {
        connection_name?: string
        connection_type?: string
      } | null
      connection_names.set(
        id,
        conn?.connection_name ?? conn?.connection_type ?? id
      )
    }

    if (args.json) return print_json({ ...user, identities })

    log.info(`👤 ${user.id}`)
    log.info(`  Email:      ${user.email ?? '-'} (verified: ${yes_no(user.email_verified)})`)
    log.info(`  Name:       ${user.name ?? '-'}`)
    if (user.phone) log.info(`  Phone:      ${user.phone}`)
    if (user.country_iso) log.info(`  Country:    ${user.country_iso}`)
    log.info(`  Created:    ${user.createdAt ?? '-'}`)
    log.info(
      `  Last login: ${user.last_login ? `${user.last_login} (${when(user.last_login)})` : '-'}${user.last_ip ? ` from ${user.last_ip}` : ''}`
    )
    log.info(`  Logins:     ${user.logins_count ?? 0}`)
    if (user.suspended) {
      log.info(`  Suspended:  🔴 yes (${user.suspended_at ?? 'unknown date'})`)
      if (user.suspended_reason) log.info(`  Reason:     ${user.suspended_reason}`)
    } else {
      log.info('  Suspended:  no')
    }

    if (identities.length > 0) {
      log.info(`  Identities:`)
      for (const identity of identities) {
        const conn =
          connection_names.get(String(identity.connection ?? '')) ?? '-'
        const pd = (identity.profile_data ?? {}) as ProfileData
        const bits = [
          pd.login ?? String(identity.identity_id ?? '-'),
          pd.html_url,
          // Provider-account age is triage gold: a repo pushed from a
          // years-old GitHub account reads differently than one created
          // this morning.
          pd.created_at ? `account since ${String(pd.created_at).slice(0, 10)}` : undefined,
          pd.email && pd.email !== user.email ? `email ${pd.email}` : undefined,
          pd.location ? `location ${pd.location}` : undefined
        ].filter(Boolean)
        log.info(`    ${conn}: ${bits.join(' · ')}`)
      }
    }
  })
}
