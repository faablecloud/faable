import test from 'ava'
import { matches, pickCandidates } from './picker'

const p = (id: string, name: string, slug?: string) => ({ id, name, slug, team: '' })

const api = (all: ReturnType<typeof p>[], more: boolean, owned: ReturnType<typeof p>[] = []) => {
  const calls: object[] = []
  return {
    calls,
    listProjects: async (params: { user_id?: string }) => {
      calls.push(params)
      return params.user_id
        ? { results: owned, next: null }
        : { results: all, next: more ? 'cur' : null }
    }
  }
}

test('a customer gets every project they belong to', async t => {
  const a = api([p('project_1', 'Web'), p('project_2', 'Api')], false)
  const c = await pickCandidates(a, 'user_me')
  t.deepEqual(c.projects.map(x => x.id), ['project_1', 'project_2'])
  t.false(c.search_remote)
  t.is(a.calls.length, 1)
})

test('a staff session starts from its own projects and searches the rest', async t => {
  const a = api([p('project_x', 'Someone else')], true, [p('project_mine', 'Mine')])
  const c = await pickCandidates(a, 'user_me')
  t.deepEqual(c.projects.map(x => x.id), ['project_mine'])
  t.true(c.search_remote)
  t.deepEqual(a.calls[1], { pageSize: 200, user_id: 'user_me' })
})

test('typing filters by name, slug or id, case-insensitive', t => {
  const proj = p('project_6a8e', 'Faable Staff', 'faable-staff-0ox20')
  t.true(matches(proj, 'staff'))
  t.true(matches(proj, '0OX2'))
  t.true(matches(proj, 'project_6a8'))
  t.true(matches(proj, '  '))
  t.false(matches(proj, 'kirbic'))
})
