import test from 'ava'
import fs from 'fs-extra'
import os from 'os'
import path from 'path'
import { ContextStore } from '../lib/ContextStore'
import {
  configuredProject,
  requireProject,
  resolveProjectRef,
  setProjectFlag
} from './project'

const HEX = '6a8ebd6160324d4631c12edc'
const ID = `project_${HEX}`

const tmp_store = async (ctx?: object) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'faable-ctx-'))
  const store = new ContextStore(dir)
  if (ctx) await store.update(() => ctx)
  return store
}

const projects = (results: { id: string; name: string; slug?: string }[], next: string | null = null) => ({
  listProjects: async () => ({ results: results.map(p => ({ team: '', ...p })), next })
})

test.serial('the flag beats the env, which beats the stored project', async t => {
  const store = await tmp_store({ project: 'project_stored' })
  setProjectFlag('from-flag')
  t.deepEqual(await configuredProject(store, { FAABLE_PROJECT: 'from-env' }), {
    ref: 'from-flag',
    source: 'flag'
  })
  setProjectFlag(undefined)
  t.deepEqual(await configuredProject(store, { FAABLE_PROJECT: 'from-env' }), {
    ref: 'from-env',
    source: 'env'
  })
  t.deepEqual(await configuredProject(store, {}), {
    ref: 'project_stored',
    source: 'config'
  })
  t.is(await configuredProject(await tmp_store(), {}), undefined)
})

test('an id is taken as-is; the team_ form is the same project', async t => {
  const api = { listProjects: async () => t.fail('no lookup for an id') as never }
  t.is(await resolveProjectRef(api, ID), ID)
  t.is(await resolveProjectRef(api, `team_${HEX}`), ID)
})

test('a name or slug resolves when exactly one project matches', async t => {
  const api = projects([
    { id: ID, name: 'Faable Staff', slug: 'faable-staff-x1' },
    { id: 'project_other', name: 'Faable Staff Old' }
  ])
  t.is(await resolveProjectRef(api, 'faable staff'), ID)
  t.is(await resolveProjectRef(api, 'faable-staff-x1'), ID)
  await t.throwsAsync(resolveProjectRef(api, 'nope'), { message: /No project named/ })
})

test('two projects with the name is an error that lists both', async t => {
  const api = projects([
    { id: 'project_a', name: 'Web' },
    { id: 'project_b', name: 'web' }
  ])
  await t.throwsAsync(resolveProjectRef(api, 'Web'), { message: /project_a.*project_b/ })
})

test.serial('with nothing configured, your only project is the one', async t => {
  setProjectFlag(undefined)
  const env = process.env.FAABLE_PROJECT
  delete process.env.FAABLE_PROJECT
  try {
    const store = await tmp_store()
    t.deepEqual(await requireProject(projects([{ id: ID, name: 'Solo' }]), store), {
      id: ID,
      source: 'only'
    })
    // Several (or a page that says there are more): the caller must choose.
    await t.throwsAsync(
      requireProject(projects([{ id: ID, name: 'A' }], 'more'), store),
      { message: /faable project use/ }
    )
    await t.throwsAsync(requireProject(projects([]), store), {
      message: /No project selected/
    })
  } finally {
    if (env !== undefined) process.env.FAABLE_PROJECT = env
  }
})
