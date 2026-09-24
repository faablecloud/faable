import test from 'ava'
import { prepare_rows } from '../import'
import { ADAPTERS } from './adapters'
import { parse_csv, parse_records } from './records'

// One realistic record per provider, in the shape its export actually has.
// Hashes are the vectors of auth's password.import.test.ts (all `hunter2`
// except Firebase's README sample, `user1password`).
const BCRYPT = '$2a$10$12LZsKULwQ1kXjYkCSaUzeYOVw/vDs4L887.zfnT9UEcBRjXtWeXK'

const row = (adapted: ReturnType<(typeof ADAPTERS)['auth0']>) => {
  if ('skip' in adapted) throw new Error(`skipped: ${adapted.skip}`)
  return adapted.row
}

// ── records ────────────────────────────────────────────────────────────────

test('csv: quotes, escaped quotes, embedded commas and newlines, BOM', t => {
  const text = '﻿a,b,c\r\n1,"x, y","say ""hi"""\n2,"multi\nline",\n'
  t.deepEqual(parse_csv(text), [
    { a: '1', b: 'x, y', c: 'say "hi"' },
    { a: '2', b: 'multi\nline', c: '' }
  ])
})

test('csv: a row with the wrong number of fields is an error, not a shifted row', t => {
  t.throws(() => parse_csv('a,b\n1,2,3\n'), { message: /row 2 has 3 fields/ })
})

test('json: array, { users: [] } wrapper and NDJSON all read', t => {
  t.deepEqual(parse_records('[{"a":1}]', 'json'), [{ a: 1 }])
  t.deepEqual(parse_records('{"users":[{"a":1}]}', 'json'), [{ a: 1 }])
  t.deepEqual(parse_records('{"a":1}\n{"a":2}\n', 'json'), [{ a: 1 }, { a: 2 }])
  t.throws(() => parse_records('{"a":1}\nnope\n', 'json'), { message: /line 2/ })
})

// ── adapters ───────────────────────────────────────────────────────────────

test('auth0: passwordHash, profile, and social identities with a connection map', t => {
  const r = row(
    ADAPTERS.auth0(
      {
        user_id: 'auth0|5f1',
        email: 'ana@example.com',
        email_verified: true,
        name: 'Ana',
        passwordHash: BCRYPT,
        user_metadata: { plan: 'pro' },
        identities: [
          { provider: 'auth0', user_id: '5f1', connection: 'Username-Password-Authentication' },
          { provider: 'google-oauth2', user_id: '1099', connection: 'google-oauth2' }
        ]
      },
      { connection_map: { 'google-oauth2': 'google' } }
    )
  )
  t.deepEqual(r, {
    email: 'ana@example.com',
    email_verified: true,
    name: 'Ana',
    password_hash: BCRYPT,
    user_metadata: { plan: 'pro' },
    identities: [{ connection: 'google', identity_id: '1099' }]
  })
})

test('auth0: a social-only user without identities comes from provider|id', t => {
  const r = row(ADAPTERS.auth0({ user_id: 'github|42', email: 'gh@example.com' }, {}))
  t.deepEqual(r.identities, [{ connection: 'github', identity_id: '42' }])
  t.is(r.password_hash, undefined)
})

test('clerk: CSV row with bcrypt, and scrypt_firebase split into its parts', t => {
  const [bcrypt_row, firebase_row] = parse_csv(
    [
      'id,first_name,last_name,username,primary_email_address,verified_email_addresses,password_digest,password_hasher',
      `user_1,Ana,Pérez,,ana@example.com,ana@example.com,${BCRYPT},bcrypt`,
      'user_2,Bo,,,bo@example.com,,lSrfV15c==$42xEC+ixf3L2lw==$jxspr8Ki==$Bw==$8$14,scrypt_firebase'
    ].join('\n')
  )
  t.deepEqual(row(ADAPTERS.clerk(bcrypt_row, {})), {
    email: 'ana@example.com',
    email_verified: true,
    given_name: 'Ana',
    family_name: 'Pérez',
    name: 'Ana Pérez',
    password_hash: BCRYPT
  })
  const bo = row(ADAPTERS.clerk(firebase_row, {}))
  t.false(bo.email_verified)
  t.deepEqual(bo.password_hash, {
    algorithm: 'firebase-scrypt',
    hash: 'lSrfV15c==',
    salt: '42xEC+ixf3L2lw==',
    params: { signer_key: 'jxspr8Ki==', salt_separator: 'Bw==', rounds: '8', mem_cost: '14' }
  })
})

test('clerk: a fast digest is passed on for the server to refuse, not dropped', t => {
  const r = row(
    ADAPTERS.clerk(
      { primary_email_address: 'md5@example.com', password_digest: '5f4dcc3b', password_hasher: 'md5' },
      {}
    )
  )
  t.deepEqual(r.password_hash, { algorithm: 'md5', hash: '5f4dcc3b' })
})

test('firebase: hash + salt + the project parameters, providers mapped', t => {
  const firebase = { signer_key: 'jxspr8Ki==', salt_separator: 'Bw==', rounds: 8, mem_cost: 14 }
  const r = row(
    ADAPTERS.firebase(
      {
        localId: 'abc',
        email: 'fb@example.com',
        emailVerified: true,
        displayName: 'Fire Base',
        passwordHash: 'lSrfV15c==',
        salt: '42xEC+ixf3L2lw==',
        providerUserInfo: [
          { providerId: 'password', rawId: 'fb@example.com' },
          { providerId: 'google.com', rawId: '1099' }
        ]
      },
      { firebase }
    )
  )
  t.deepEqual(r.password_hash, {
    algorithm: 'firebase-scrypt',
    hash: 'lSrfV15c==',
    salt: '42xEC+ixf3L2lw==',
    params: firebase
  })
  t.deepEqual(r.identities, [{ connection: 'google', identity_id: '1099' }])
})

test('firebase: a password hash without the project parameters stops the import', t => {
  t.throws(() => ADAPTERS.firebase({ email: 'x@example.com', passwordHash: 'aaa', salt: 'bbb' }, {}), {
    message: /--hash-key/
  })
})

test('supabase: auth.users dump with confirmed email and metadata as a JSON string', t => {
  const [record] = parse_csv(
    [
      'id,email,encrypted_password,email_confirmed_at,raw_user_meta_data',
      `9f2,sb@example.com,${BCRYPT},2026-01-02 10:00:00+00,"{""full_name"":""Supa Base"",""avatar_url"":""https://x/a.png""}"`
    ].join('\n')
  )
  t.deepEqual(row(ADAPTERS.supabase(record, {})), {
    email: 'sb@example.com',
    email_verified: true,
    name: 'Supa Base',
    picture: 'https://x/a.png',
    user_metadata: { full_name: 'Supa Base', avatar_url: 'https://x/a.png' },
    password_hash: BCRYPT
  })
})

test('keycloak: pbkdf2-sha256 credential and federated identities', t => {
  const r = row(
    ADAPTERS.keycloak(
      {
        username: 'kc',
        email: 'kc@example.com',
        emailVerified: true,
        firstName: 'Key',
        lastName: 'Cloak',
        credentials: [
          {
            type: 'password',
            secretData: '{"value":"sHwEmfTQ==","salt":"MDEyMzQ1Njc4OWFiY2RlZg==","additionalParameters":{}}',
            credentialData: '{"hashIterations":27500,"algorithm":"pbkdf2-sha256","additionalParameters":{}}'
          }
        ],
        federatedIdentities: [{ identityProvider: 'github', userId: '42', userName: 'kc' }]
      },
      {}
    )
  )
  t.deepEqual(r.password_hash, {
    algorithm: 'pbkdf2-sha256',
    hash: 'sHwEmfTQ==',
    salt: 'MDEyMzQ1Njc4OWFiY2RlZg==',
    params: { iterations: 27500 }
  })
  t.deepEqual(r.identities, [{ connection: 'github', identity_id: '42' }])
  t.is(r.name, 'Key Cloak')
})

test('keycloak: argon2 (24+) is rebuilt into a PHC string; bare pbkdf2 is SHA-1', t => {
  const argon2 = row(
    ADAPTERS.keycloak(
      {
        email: 'a2@example.com',
        credentials: [
          {
            type: 'password',
            secretData: '{"value":"yVImX/ldehTxZsho==","salt":"8dkjGiWGpr5pRQi2CaV6Ug==","additionalParameters":{}}',
            credentialData:
              '{"hashIterations":5,"algorithm":"argon2","additionalParameters":{"hashLength":["32"],"memory":["7168"],"type":["id"],"version":["1.3"],"parallelism":["1"]}}'
          }
        ]
      },
      {}
    )
  )
  t.is(argon2.password_hash, '$argon2id$v=19$m=7168,t=5,p=1$8dkjGiWGpr5pRQi2CaV6Ug$yVImX/ldehTxZsho')

  const sha1 = row(
    ADAPTERS.keycloak(
      {
        email: 's1@example.com',
        credentials: [
          {
            type: 'password',
            secretData: '{"value":"aaa","salt":"bbb"}',
            credentialData: '{"hashIterations":27500,"algorithm":"pbkdf2"}'
          }
        ]
      },
      {}
    )
  )
  t.is((sha1.password_hash as any).algorithm, 'pbkdf2-sha1')
})

test('faable: an export row goes back in as-is', t => {
  const exported = {
    user_id: 'user_1',
    email: 'f@example.com',
    email_verified: true,
    password_hash_status: 'set',
    password_hash: BCRYPT,
    identities: [{ connection: 'github', identity_id: '7' }]
  }
  t.like(row(ADAPTERS.faable(exported, {})), {
    email: 'f@example.com',
    password_hash: BCRYPT
  })
})

// ── prepare_rows ───────────────────────────────────────────────────────────

test('prepare_rows keeps the file position and reports records without email', t => {
  const text = [
    JSON.stringify({ email: 'a@example.com', passwordHash: BCRYPT }),
    JSON.stringify({ user_id: 'sms|1', phone_number: '+34600000000' }),
    JSON.stringify({ email: 'c@example.com' })
  ].join('\n')
  const { total, rows, skipped } = prepare_rows(text, 'auth0', {})
  t.is(total, 3)
  t.deepEqual(
    rows.map(r => [r.record, r.row.email]),
    [
      [1, 'a@example.com'],
      [3, 'c@example.com']
    ]
  )
  t.deepEqual(skipped, [
    { record: 2, status: 'error', error: { code: 'unusable_record', message: 'no email' } }
  ])
})
