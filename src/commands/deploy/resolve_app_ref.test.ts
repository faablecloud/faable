import test from 'ava'
import { FaableApp } from '../../api/FaableApi'
import { resolve_app_ref } from './resolve_app_id'

const app = (id: string, name: string, slug?: string) =>
  ({ id, name, slug }) as FaableApp

const fake_api = (apps: FaableApp[], seen: (string | null)[] = []) => ({
  listApps: async (_p: unknown, project: string | null = null) => {
    seen.push(project)
    return { results: apps, next: null }
  },
  listProjects: async () => ({ results: [], next: null })
})

test('an app id is taken as-is, without a request', async t => {
  const seen: (string | null)[] = []
  t.is(
    await resolve_app_ref(fake_api([], seen), 'app_6abd4f9cd838bcb4142c6491'),
    'app_6abd4f9cd838bcb4142c6491'
  )
  t.deepEqual(seen, [])
})

test('a name or slug is looked up inside ONE project', async t => {
  const seen: (string | null)[] = []
  const api = fake_api(
    [app('app_1', 'Landing', 'landing-x1'), app('app_2', 'docs')],
    seen
  )
  t.is(await resolve_app_ref(api, 'landing', 'project_a'), 'app_1')
  t.is(await resolve_app_ref(api, 'landing-x1', 'project_a'), 'app_1')
  // Every lookup is scoped: never the unscoped listing a staff session
  // would get, with every customer's app in it.
  t.deepEqual(seen, ['project_a', 'project_a'])
})

test('no match or several matches is an error, never a guess', async t => {
  const api = fake_api([app('app_1', 'web'), app('app_2', 'web')])
  const several = await t.throwsAsync(resolve_app_ref(api, 'web', 'project_a'))
  t.regex(several!.message, /app_1, app_2/)
  const none = await t.throwsAsync(resolve_app_ref(api, 'api', 'project_a'))
  t.is((none as { code?: string }).code, 'not_found')
})
