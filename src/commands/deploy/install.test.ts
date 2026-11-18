import test from 'ava'
import type { FaableCatalogBlueprint } from '../../api/FaableApi'
import {
  app_name_from_title,
  catalog_lines,
  domain_problem,
  missing_fields,
  parse_inputs,
  wait_for_installation
} from './install_lib'

// `faable deploy install wordpress`: the inputs, what is missing before
// anything is sent, the catalogue listing and the wait.

const WP: FaableCatalogBlueprint = {
  slug: 'wordpress',
  name: 'WordPress',
  description: null,
  icon: 'wordpress',
  version: 1,
  plans: ['hobby', 'pro'],
  create_form: [
    { name: 'title', label: 'Site title', type: 'string', required: true },
    {
      name: 'admin_email',
      label: 'Admin email',
      type: 'email',
      required: true
    },
    { name: 'locale', label: 'Language', type: 'locale', required: false }
  ],
  database: { engine: 'mariadb', tiers: ['db-s', 'db-m'] }
}

test('inputs: name=value, the value may hold = and spaces', t => {
  t.deepEqual(parse_inputs(['title=My site', 'admin_email=a@b.co', 'x=a=b']), {
    title: 'My site',
    admin_email: 'a@b.co',
    x: 'a=b'
  })
  t.deepEqual(parse_inputs(), {})
  t.throws(() => parse_inputs(['title']), { message: /name=value/ })
  t.throws(() => parse_inputs(['=x']))
})

test('the required fields left empty are named before anything is sent', t => {
  t.deepEqual(
    missing_fields(WP, { title: 'Blog' }).map(f => f.name),
    ['admin_email']
  )
  t.deepEqual(
    missing_fields(WP, { title: ' ', admin_email: 'a@b.co' }).map(f => f.name),
    ['title']
  )
  t.deepEqual(missing_fields(WP, { title: 'Blog', admin_email: 'a@b.co' }), [])
})

test('the catalogue: one line per app with its plans, tiers and inputs', t => {
  const [line] = catalog_lines([WP])
  t.regex(line, /^wordpress/)
  t.regex(line, /hobby, pro/)
  t.regex(line, /database db-s\/db-m/)
  t.regex(line, /--input title, admin_email, locale\?/)
})

const fakeApi = (states: Array<{ state: string; error?: string | null }>) => {
  let i = 0
  return {
    calls: () => i,
    api: {
      getInstallation: async () => {
        const s = states[Math.min(i++, states.length - 1)]
        return {
          id: 'installation_1',
          team: 'project_1',
          blueprint_slug: 'wordpress',
          name: 'blog',
          app_id: 'app_1',
          error: null,
          ...s
        }
      }
    }
  }
}

test('wait: ready after installing', async t => {
  const f = fakeApi([
    { state: 'installing' },
    { state: 'installing' },
    { state: 'ready' }
  ])
  const r = await wait_for_installation(
    f.api,
    { id: 'installation_1', team: 'project_1' },
    { timeout_s: 60, sleep: async () => {}, poll_ms: 1 }
  )
  t.deepEqual(r, { state: 'ready', done: true, ok: true })
  t.is(f.calls(), 3)
})

test('wait: a failure says why', async t => {
  const f = fakeApi([{ state: 'failed', error: 'install task failed' }])
  const r = await wait_for_installation(
    f.api,
    { id: 'installation_1', team: 'project_1' },
    { timeout_s: 60, sleep: async () => {} }
  )
  t.deepEqual(r, {
    state: 'failed',
    done: true,
    ok: false,
    error: 'install task failed'
  })
})

test('wait: gives up at the timeout, the install goes on', async t => {
  let clock = 0
  const f = fakeApi([{ state: 'installing' }])
  const r = await wait_for_installation(
    f.api,
    { id: 'installation_1', team: 'project_1' },
    {
      timeout_s: 10,
      now: () => clock,
      sleep: async ms => {
        clock += ms
      },
      poll_ms: 4000
    }
  )
  t.deepEqual(r, { state: 'installing', done: false, ok: false })
})

test('name from the title: accents out, a slug of at least 3', t => {
  t.is(app_name_from_title('Café & Co.'), 'cafe-co')
  t.is(app_name_from_title('  My   Blog!! '), 'my-blog')
  t.is(app_name_from_title('Yo'), 'yo-site')
  t.is(app_name_from_title('¡¡!!'), 'site')
  t.true(app_name_from_title('a'.repeat(80)).length <= 50)
})

test('domain: a bare hostname, not one of faable.link or faable.com', t => {
  t.is(domain_problem('www.example.com'), null)
  t.is(domain_problem('example.co.uk'), null)
  t.regex(domain_problem('https://www.example.com')!, /hostname on its own/)
  t.regex(domain_problem('www.example.com/blog')!, /hostname on its own/)
  t.regex(domain_problem('blog.faable.link')!, /assigned by Faable/)
  t.regex(domain_problem('faable.com')!, /assigned by Faable/)
  t.is(domain_problem('notfaable.com'), null)
})
