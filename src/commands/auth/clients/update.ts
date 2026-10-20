import { CommandModule } from 'yargs'
import { requireAuthAdmin, withAuthHints } from '../../../api/auth_admin'
import { log } from '../../../log'
import { TenantArgs, json_option, tenant_options } from '../options'
import { print_json } from '../render'
import {
  ProfileFieldDeclaration,
  apply_field_changes,
  format_field,
  parse_field_spec,
  parse_fields_json
} from './profile_fields'
import {
  LoginMethodsConfig,
  PasskeyChoice,
  apply_login_method_changes,
  effective_login_methods,
  has_login_method_changes
} from './login_methods'
import { resolve_client } from './resolve'

interface ClientsUpdateArgs extends TenantArgs {
  client_id: string
  name?: string
  description?: string
  addCallback?: string[]
  removeCallback?: string[]
  addLogoutUrl?: string[]
  removeLogoutUrl?: string[]
  addWebOrigin?: string[]
  removeWebOrigin?: string[]
  addField?: string[]
  removeField?: string[]
  fieldsJson?: string
  inheritFields?: boolean
  onlyConnections?: string[]
  disableConnection?: string[]
  enableConnection?: string[]
  passkeyLogin?: PasskeyChoice
  inheritLoginMethods?: boolean
}

// The update route replaces each list whole, so every list change here is a
// read-modify-write of what the client has now: adding a callback never drops
// the others.
const edit_list = (
  current: string[] | undefined,
  add: string[] = [],
  remove: string[] = []
): string[] | undefined => {
  if (!add.length && !remove.length) return undefined
  const next = (current ?? []).filter(u => !remove.includes(u))
  for (const u of add) if (!next.includes(u)) next.push(u)
  return next
}

export const clients_update: CommandModule<unknown, ClientsUpdateArgs> = {
  command: 'update <client_id>',
  describe: 'Update an OAuth client (name, URLs, profile fields, login methods)',
  builder: yargs =>
    json_option(tenant_options(yargs))
      .positional('client_id', {
        type: 'string',
        demandOption: true,
        description: 'Client resource id or OAuth client_id'
      })
      .option('name', {
        alias: 'n',
        type: 'string',
        description: 'New client name'
      })
      .option('description', {
        alias: 'd',
        type: 'string',
        description: 'New client description'
      })
      .option('add-callback', {
        type: 'string',
        array: true,
        description: 'Add an allowed callback (redirect) URL — repeatable'
      })
      .option('remove-callback', {
        type: 'string',
        array: true,
        description: 'Remove an allowed callback URL — repeatable'
      })
      .option('add-logout-url', {
        type: 'string',
        array: true,
        description: 'Add an allowed post-logout URL — repeatable'
      })
      .option('remove-logout-url', {
        type: 'string',
        array: true,
        description: 'Remove an allowed post-logout URL — repeatable'
      })
      .option('add-web-origin', {
        type: 'string',
        array: true,
        description: 'Add an allowed web origin (CORS) — repeatable'
      })
      .option('remove-web-origin', {
        type: 'string',
        array: true,
        description: 'Remove an allowed web origin — repeatable'
      })
      .option('add-field', {
        type: 'string',
        array: true,
        description:
          'Declare a profile field users may write with PATCH /me: key, key:string[:max_length] or key:enum:a,b,c. Re-adding a key replaces it — repeatable'
      })
      .option('remove-field', {
        type: 'string',
        array: true,
        description: 'Remove a declared profile field by key — repeatable'
      })
      .option('fields-json', {
        type: 'string',
        description:
          'Replace the whole profile field list with a JSON array of {key, type, options?, max_length?}'
      })
      .option('inherit-fields', {
        type: 'boolean',
        description:
          "Drop this client's own profile field list and use the tenant's again"
      })
      .option('only-connections', {
        type: 'string',
        array: true,
        description:
          'Offer exactly these connections (id or name) on this client\'s login screen; every other one is removed'
      })
      .option('disable-connection', {
        type: 'string',
        array: true,
        description:
          'Stop offering a connection (id or name) on this client, also at /authorize — repeatable'
      })
      .option('enable-connection', {
        type: 'string',
        array: true,
        description: 'Offer a removed connection again — repeatable'
      })
      .option('passkey-login', {
        choices: ['on', 'off', 'inherit'] as const,
        description:
          "Passkey sign-in button on this client's login screen; inherit follows the tenant (Pro plan)"
      })
      .option('inherit-login-methods', {
        type: 'boolean',
        description:
          "Drop this client's own login methods and follow the tenant's again"
      })
      .conflicts('fields-json', ['add-field', 'remove-field', 'inherit-fields'])
      .conflicts('inherit-fields', ['add-field', 'remove-field'])
      .conflicts('inherit-login-methods', [
        'only-connections',
        'disable-connection',
        'enable-connection',
        'passkey-login'
      ])
      .conflicts('only-connections', 'disable-connection')
      .example(
        '$0 auth clients update my-admin --only-connections OTP --passkey-login on',
        'Sign in to my-admin only with a passkey or an email code'
      )
      .example(
        '$0 auth clients update my-app --add-field profile:enum:student,teacher',
        'Let users of my-app pick their profile with auth-js updateProfile'
      )
      .example(
        '$0 auth clients update my-app --remove-field school',
        'Stop accepting a field'
      )
      .example(
        '$0 auth clients update my-app --add-callback https://app.example.com/cb',
        'Allow one more redirect URL, keeping the others'
      )
      .showHelpOnFail(false) as any,
  handler: withAuthHints(async args => {
    // Parse everything before any request, so a bad spec costs nothing.
    const adds = (args.addField ?? []).map(parse_field_spec)
    const full = args.fieldsJson
      ? parse_fields_json(args.fieldsJson)
      : undefined

    const api = await requireAuthAdmin(args)
    const client = await resolve_client(api, args.client_id)
    const own = (
      client as { profile_fields?: ProfileFieldDeclaration[] | null }
    ).profile_fields

    let profile_fields: ProfileFieldDeclaration[] | null | undefined
    if (full) profile_fields = full
    else if (args.inheritFields) profile_fields = null
    else if (adds.length || args.removeField?.length) {
      profile_fields = apply_field_changes(own, adds, args.removeField ?? [])
    }

    const callbacks = edit_list(
      client.callbacks,
      args.addCallback,
      args.removeCallback
    )
    const logout_urls = edit_list(
      client.logout_urls,
      args.addLogoutUrl,
      args.removeLogoutUrl
    )
    const web_origins = edit_list(
      client.web_origins,
      args.addWebOrigin,
      args.removeWebOrigin
    )

    const login_changes = {
      only: args.onlyConnections,
      disable: args.disableConnection,
      enable: args.enableConnection,
      passkey: args.passkeyLogin,
      inherit: args.inheritLoginMethods
    }
    const own_login = (client as { login_methods?: LoginMethodsConfig | null })
      .login_methods
    let tenant_login: LoginMethodsConfig | null | undefined
    let connections: any[] = []
    let login_methods: LoginMethodsConfig | null | undefined
    if (has_login_method_changes(login_changes)) {
      const [account, all] = await Promise.all([
        api.currentAccount(),
        api.connectionList().all()
      ])
      tenant_login = (account as { login_methods?: LoginMethodsConfig | null })
        .login_methods
      connections = all as any[]
      login_methods = apply_login_method_changes(
        own_login,
        tenant_login,
        connections,
        login_changes
      )
    }

    const patch = {
      ...(args.name !== undefined ? { name: args.name } : {}),
      ...(args.description !== undefined
        ? { description: args.description }
        : {}),
      ...(callbacks ? { callbacks } : {}),
      ...(logout_urls ? { logout_urls } : {}),
      ...(web_origins ? { web_origins } : {}),
      ...(profile_fields !== undefined ? { profile_fields } : {}),
      ...(login_methods !== undefined ? { login_methods } : {})
    }
    if (Object.keys(patch).length === 0) {
      throw new Error(
        'Nothing to update — pass a --name, --description, an --add-*/--remove-* option, --fields-json, --inherit-fields or a login-method option'
      )
    }

    const updated = await api.clientUpdate(client.id, patch as any)
    if (args.json) return print_json(updated)

    log.info(`✅ Updated client "${updated.name}" (${updated.client_id})`)
    if (login_methods !== undefined) {
      const now = effective_login_methods(
        (updated as { login_methods?: LoginMethodsConfig | null })
          .login_methods,
        tenant_login,
        connections
      )
      const names = now.connections.map(
        c => `${c.connection_name} (${c.connection_type})`
      )
      if (now.passkey) names.unshift('passkey')
      log.info(`  Login screen: ${names.length ? names.join(', ') : 'nothing'}`)
      if (login_methods === null) {
        log.info("  Login methods: inherited from the tenant")
      }
    }
    if (profile_fields !== undefined) {
      const now = (
        updated as { profile_fields?: ProfileFieldDeclaration[] | null }
      ).profile_fields
      if (!now) {
        log.info('  Profile fields: inherited from the tenant')
      } else {
        log.info(
          `  Profile fields: ${now.length ? now.map(format_field).join(', ') : 'none'}`
        )
        // The first own list silently stops inheriting the tenant's: say so.
        if (!own) {
          log.info(
            "  ℹ️ This client now has its own list, which replaces the tenant's for it. --inherit-fields undoes that."
          )
        }
      }
    }
  })
}
