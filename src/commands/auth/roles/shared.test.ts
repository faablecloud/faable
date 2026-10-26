import test from 'ava'
import { resolve_api_ref, resolve_role_ref } from './shared'

const paginator = (results: unknown[]) => ({
  pass: async () => ({ results, next: null })
})

const ROLE_ID = 'role_6555fd293acc2f0fac0e3452'

const fake = (roles: any[], apis: any[]) =>
  ({
    roleGet: async (id: string) => roles.find(r => r.id === id),
    roleList: () => paginator(roles),
    apiGet: async (id: string) => apis.find(a => a.id === id),
    apiList: () => paginator(apis)
  }) as any

test('a role by id or by exact name; a partial name is not a match', async t => {
  const api = fake(
    [
      { id: ROLE_ID, name: 'support' },
      { id: 'role_6555fd293acc2f0fac0e3453', name: 'support-lead' }
    ],
    []
  )
  t.is((await resolve_role_ref(api, ROLE_ID)).name, 'support')
  t.is((await resolve_role_ref(api, 'support-lead')).name, 'support-lead')
  await t.throwsAsync(resolve_role_ref(api, 'supp'), {
    message: /No role named/
  })
})

test('two roles with the same name: ask for the id', async t => {
  const api = fake(
    [
      { id: ROLE_ID, name: 'staff' },
      { id: 'role_6555fd293acc2f0fac0e3453', name: 'staff' }
    ],
    []
  )
  await t.throwsAsync(resolve_role_ref(api, 'staff'), {
    message: /pass the role id/
  })
})

test('an API by id or by its exact identifier', async t => {
  const api = fake(
    [],
    [
      {
        id: 'api_6555fd293acc2f0fac0e3454',
        identifier: 'https://api.example.com',
        name: 'A'
      }
    ]
  )
  t.is((await resolve_api_ref(api, 'https://api.example.com')).name, 'A')
  t.is((await resolve_api_ref(api, 'api_6555fd293acc2f0fac0e3454')).name, 'A')
  await t.throwsAsync(resolve_api_ref(api, 'https://other.example.com'), {
    message: /No API with identifier/
  })
})
