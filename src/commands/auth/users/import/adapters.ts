import { RawRecord } from './records'

// One adapter per provider: an export record → the row `POST /user/import`
// takes. Adapters only reshape — they never judge a hash. The server decides
// what is weak or unreadable and answers per row, so the CLI cannot drift from
// the rules it enforces.

export type PasswordHash =
  | string
  | {
      algorithm: string
      hash: string
      salt?: string
      params?: Record<string, number | string>
    }

export interface ImportIdentity {
  connection: string
  identity_id: string
  profile_data?: Record<string, unknown>
}

export interface ImportRow {
  email: string
  email_verified?: boolean
  name?: string
  given_name?: string
  family_name?: string
  phone?: string
  picture?: string
  locale?: string
  user_metadata?: Record<string, unknown>
  app_metadata?: Record<string, unknown>
  password_hash?: PasswordHash
  identities?: ImportIdentity[]
}

export interface FirebaseHashConfig {
  signer_key: string
  salt_separator: string
  rounds: number
  mem_cost: number
}

export interface AdapterOptions {
  // Provider connection name → Faable connection_name, for identities
  // (`google-oauth2=google`). Unmapped names pass through unchanged.
  connection_map?: Record<string, string>
  firebase?: FirebaseHashConfig
}

// A record that cannot become a row, with the reason. Reported, never sent.
export type Adapted = { row: ImportRow } | { skip: string }

export const SOURCES = [
  'auth0',
  'clerk',
  'firebase',
  'supabase',
  'keycloak',
  'faable'
] as const
export type Source = (typeof SOURCES)[number]

export const SOURCE_FORMAT: Record<Source, 'json' | 'csv'> = {
  auth0: 'json',
  clerk: 'csv',
  firebase: 'json',
  // A Supabase table dump can be either; `--format` overrides.
  supabase: 'csv',
  keycloak: 'json',
  faable: 'json'
}

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined

const bool = (v: unknown): boolean | undefined => {
  if (typeof v === 'boolean') return v
  if (v === 'true' || v === 't' || v === '1') return true
  if (v === 'false' || v === 'f' || v === '0') return false
  return undefined
}

const obj = (v: unknown): Record<string, unknown> | undefined => {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    return v as Record<string, unknown>
  }
  if (typeof v === 'string' && v.trim().startsWith('{')) {
    try {
      return JSON.parse(v)
    } catch {
      return undefined
    }
  }
  return undefined
}

const unpad = (b64: string) => b64.replace(/=+$/, '')

// Drops undefined keys so the row stays small and `additionalProperties`
// never sees a `null` where the server expects a string.
const clean = <T extends object>(row: T): T =>
  Object.fromEntries(
    Object.entries(row).filter(([, v]) => v !== undefined && v !== null)
  ) as T

const map_connection = (name: string, opts: AdapterOptions) =>
  opts.connection_map?.[name] ?? name

const with_email = (row: Omit<ImportRow, 'email'> & { email?: string }): Adapted =>
  row.email ? { row: clean(row as ImportRow) } : { skip: 'no email' }

// ── Auth0 ──────────────────────────────────────────────────────────────────
// The password-hash export Auth0 support hands over (NDJSON, `passwordHash`
// in bcrypt), or its own bulk-import shape (`custom_password_hash`).
const auth0 = (r: RawRecord, opts: AdapterOptions): Adapted => {
  const custom = obj(r.custom_password_hash)
  const custom_hash = obj(custom?.hash)
  const password_hash =
    str(r.passwordHash) ??
    str(r.password_hash) ??
    (custom && str(custom_hash?.value)
      ? String(custom_hash!.value)
      : undefined)

  const identities = (Array.isArray(r.identities) ? r.identities : [])
    .map(obj)
    .filter(
      (i): i is Record<string, unknown> =>
        !!i && i.provider !== 'auth0' && i.user_id !== undefined
    )
    .map(i => ({
      connection: map_connection(String(i.connection ?? i.provider), opts),
      identity_id: String(i.user_id)
    }))
  // A social-only user exported without `identities`: `provider|id`.
  const user_id = str(r.user_id)
  if (!identities.length && user_id?.includes('|') && !user_id.startsWith('auth0|')) {
    const [provider, id] = user_id.split('|')
    identities.push({ connection: map_connection(provider, opts), identity_id: id })
  }

  return with_email({
    email: str(r.email),
    email_verified: bool(r.email_verified),
    name: str(r.name),
    given_name: str(r.given_name),
    family_name: str(r.family_name),
    picture: str(r.picture),
    user_metadata: obj(r.user_metadata),
    app_metadata: obj(r.app_metadata),
    password_hash,
    identities: identities.length ? identities : undefined
  })
}

// ── Clerk ──────────────────────────────────────────────────────────────────
// The CSV from the Clerk dashboard: `password_digest` + `password_hasher`.
const clerk_hash = (
  digest: string | undefined,
  hasher: string | undefined
): PasswordHash | undefined => {
  if (!digest) return undefined
  switch (hasher) {
    // Self-describing digests go as they are. Clerk keeps Django's
    // `pbkdf2_sha256$iterations$salt$hash` unchanged.
    case 'bcrypt':
    case 'argon2id':
    case 'argon2i':
    case 'pbkdf2_sha256':
    case 'pbkdf2_sha256_django':
    case undefined:
      return digest
    case 'scrypt_firebase': {
      // `<hash>$<salt>$<signer key>$<salt separator>$<rounds>$<mem cost>`
      const [hash, salt, signer_key, salt_separator, rounds, mem_cost] =
        digest.split('$')
      return {
        algorithm: 'firebase-scrypt',
        hash,
        salt,
        params: { signer_key, salt_separator, rounds, mem_cost }
      }
    }
    default:
      // md5, sha256, bcrypt_sha256_django…: the server answers
      // weak_password_hash for that row.
      return { algorithm: hasher, hash: digest }
  }
}

const clerk = (r: RawRecord): Adapted => {
  const email = str(r.primary_email_address) ?? str(r.email_address)
  const verified = String(r.verified_email_addresses ?? '')
    .split(/[|,;\s]+/)
    .filter(Boolean)
  const given_name = str(r.first_name)
  const family_name = str(r.last_name)
  return with_email({
    email,
    email_verified: email ? verified.includes(email) : undefined,
    given_name,
    family_name,
    name: [given_name, family_name].filter(Boolean).join(' ') || undefined,
    phone: str(r.primary_phone_number),
    password_hash: clerk_hash(str(r.password_digest), str(r.password_hasher))
  })
}

// ── Firebase ───────────────────────────────────────────────────────────────
// `firebase auth:export users.json --format=json`. The hash parameters are
// project-wide and live in the console (Authentication → Users → ⋮ →
// Password hash parameters), not in the export.
const FIREBASE_PROVIDERS: Record<string, string> = {
  'google.com': 'google',
  'github.com': 'github',
  'facebook.com': 'facebook',
  'apple.com': 'apple',
  'twitter.com': 'twitter',
  'microsoft.com': 'microsoft'
}

const firebase = (r: RawRecord, opts: AdapterOptions): Adapted => {
  let password_hash: PasswordHash | undefined
  const hash = str(r.passwordHash)
  if (hash) {
    if (!opts.firebase) {
      throw new Error(
        'Firebase exports need the project hash parameters: --hash-key, --salt-separator, --rounds and --mem-cost (Firebase console → Authentication → Users → ⋮ → Password hash parameters)'
      )
    }
    password_hash = {
      algorithm: 'firebase-scrypt',
      hash,
      salt: str(r.salt) ?? '',
      params: { ...opts.firebase }
    }
  }

  const identities = (Array.isArray(r.providerUserInfo) ? r.providerUserInfo : [])
    .map(obj)
    .filter((p): p is Record<string, unknown> => !!p && p.providerId !== 'password' && p.providerId !== 'phone')
    .map(p => {
      const provider = String(p.providerId)
      return {
        connection: map_connection(
          FIREBASE_PROVIDERS[provider] ?? provider.replace(/\.com$/, ''),
          opts
        ),
        identity_id: String(p.rawId)
      }
    })

  return with_email({
    email: str(r.email),
    email_verified: bool(r.emailVerified),
    name: str(r.displayName),
    picture: str(r.photoUrl),
    phone: str(r.phoneNumber),
    password_hash,
    identities: identities.length ? identities : undefined
  })
}

// ── Supabase ───────────────────────────────────────────────────────────────
// A dump of `auth.users` (CSV or JSON): `encrypted_password` is bcrypt.
const supabase = (r: RawRecord): Adapted => {
  const meta = obj(r.raw_user_meta_data)
  return with_email({
    email: str(r.email),
    email_verified: !!str(r.email_confirmed_at) || bool(r.email_verified),
    name: str(meta?.full_name) ?? str(meta?.name),
    picture: str(meta?.avatar_url) ?? str(meta?.picture),
    phone: str(r.phone),
    user_metadata: meta,
    password_hash: str(r.encrypted_password)
  })
}

// ── Keycloak ───────────────────────────────────────────────────────────────
// A realm export (`kc.sh export --users realm_file`), or one of its
// `<realm>-users-N.json` files. Password credentials keep the hash in
// `secretData` and the algorithm in `credentialData`, both JSON strings.
const keycloak_hash = (credential: Record<string, unknown>): PasswordHash | undefined => {
  const secret = obj(credential.secretData)
  const data = obj(credential.credentialData)
  const value = str(secret?.value)
  const salt = str(secret?.salt)
  if (!value || !data) return undefined
  const algorithm = String(data.algorithm ?? '')
  const iterations = Number(data.hashIterations)
  const extra = (obj(data.additionalParameters) ?? {}) as Record<string, unknown>
  const first = (k: string) =>
    Array.isArray(extra[k]) ? String((extra[k] as unknown[])[0]) : undefined

  if (algorithm === 'argon2') {
    // Keycloak 24+: parameters split out; rebuild the PHC string.
    const type = first('type') ?? 'id'
    const memory = first('memory') ?? '7168'
    const parallelism = first('parallelism') ?? '1'
    return `$argon2${type}$v=19$m=${memory},t=${iterations},p=${parallelism}$${unpad(salt ?? '')}$${unpad(value)}`
  }
  return {
    // `pbkdf2` (no suffix) is PBKDF2-SHA1: sent as such, refused as weak.
    algorithm: algorithm === 'pbkdf2' ? 'pbkdf2-sha1' : algorithm,
    hash: value,
    salt,
    params: { iterations }
  }
}

const keycloak = (r: RawRecord, opts: AdapterOptions): Adapted => {
  const credential = (Array.isArray(r.credentials) ? r.credentials : [])
    .map(obj)
    .find(c => c?.type === 'password')
  const identities = (Array.isArray(r.federatedIdentities) ? r.federatedIdentities : [])
    .map(obj)
    .filter((i): i is Record<string, unknown> => !!i)
    .map(i => ({
      connection: map_connection(String(i.identityProvider), opts),
      identity_id: String(i.userId)
    }))
  const given_name = str(r.firstName)
  const family_name = str(r.lastName)
  return with_email({
    email: str(r.email),
    email_verified: bool(r.emailVerified),
    given_name,
    family_name,
    name: [given_name, family_name].filter(Boolean).join(' ') || undefined,
    password_hash: credential ? keycloak_hash(credential) : undefined,
    identities: identities.length ? identities : undefined
  })
}

// ── Faable ─────────────────────────────────────────────────────────────────
// `faable auth users export` output: already the import shape. The server
// drops `user_id` / `password_hash_status` itself.
const faable = (r: RawRecord, opts: AdapterOptions): Adapted => {
  const row = { ...r } as Record<string, unknown>
  if (Array.isArray(row.identities)) {
    row.identities = (row.identities as ImportIdentity[]).map(i => ({
      ...i,
      connection: map_connection(i.connection, opts)
    }))
  }
  return with_email(row as unknown as ImportRow)
}

export const ADAPTERS: Record<
  Source,
  (r: RawRecord, opts: AdapterOptions) => Adapted
> = { auth0, clerk, firebase, supabase, keycloak, faable }
