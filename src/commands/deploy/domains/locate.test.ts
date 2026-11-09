import test from 'ava'
import { FaableDomain } from '../../../api/FaableApi'
import {
  add_conflict_hint,
  attach_plan,
  locate_domain,
  project_domains
} from './locate'

const TEAM = 'project_6ab15c85d4de2db5091863f4'
const domain = (fqdn: string, app_id: string | null, id = `domain_${fqdn}`) =>
  ({
    id,
    fqdn,
    app_id,
    tls: true,
    verified: true,
    active: true,
    team: TEAM
  }) as FaableDomain

// The project's listing, in pages of two: an orphan on the second page must
// still be found (the per-app listing never shows it at all).
const api = (rows: FaableDomain[]) => {
  const seen: (string | undefined)[] = []
  return {
    seen,
    listDomainsPage: async (
      app_id: string | undefined,
      team: string,
      p: { next?: string } = {}
    ) => {
      seen.push(app_id)
      if (team !== TEAM) return { results: [], next: null }
      const from = Number(p.next ?? 0)
      return {
        results: rows.slice(from, from + 2),
        next: from + 2 < rows.length ? String(from + 2) : null
      }
    }
  } as any
}

const ROWS = [
  domain('www.ciapol.com', 'app_web'),
  domain('api.ciapol.com', 'app_api'),
  domain('app.ciapol.com', null, 'domain_6aa7c0bda92b1c420f877f8f')
]

test('the lookup is the whole project, every page, never one app', async t => {
  const a = api(ROWS)
  t.is((await project_domains(a, TEAM)).length, 3)
  t.true(a.seen.every((id: string | undefined) => id === undefined))
})

// The bug: `rm` searched `listDomains(app_id)`, where a domain linked to no
// app never appears — "not attached to <app>" whatever app was passed.
test('rm: a domain linked to no app is found without --app, and with any app', async t => {
  for (const app of [null, 'app_web']) {
    const d = await locate_domain(api(ROWS), TEAM, 'APP.ciapol.com', app)
    t.is(d.id, 'domain_6aa7c0bda92b1c420f877f8f', String(app))
  }
})

test('rm: a NAMED app that is not the one the domain serves is refused', async t => {
  const err = await t.throwsAsync(
    locate_domain(api(ROWS), TEAM, 'www.ciapol.com', 'app_api')
  )
  t.regex(err!.message, /attached to app_web, not to app_api/)
  t.regex(err!.message, /domains attach www\.ciapol\.com --app app_api/)
})

test('a domain that is not in the project says so', async t => {
  const err = await t.throwsAsync(
    locate_domain(api(ROWS), TEAM, 'nope.ciapol.com', null)
  )
  t.is((err as any).code, 'not_found')
})

test('attach: links an orphan, moves one from another app, no-op on its own', t => {
  t.deepEqual(attach_plan(ROWS[2], 'app_web'), {
    kind: 'link',
    domain: ROWS[2],
    from: null
  })
  t.deepEqual(attach_plan(ROWS[1], 'app_web'), {
    kind: 'link',
    domain: ROWS[1],
    from: 'app_api'
  })
  t.is(attach_plan(ROWS[0], 'app_web').kind, 'already')
})

// `domains add` on a domain of the same project: the command that fixes it,
// whether the api is new (`domain_unlinked`) or old (anonymous `domain_taken`).
test('add on an orphan of the project names `domains attach`', async t => {
  for (const code of ['domain_taken', 'domain_unlinked']) {
    const err = await add_conflict_hint(
      api(ROWS),
      TEAM,
      'app.ciapol.com',
      'app_web',
      Object.assign(new Error('already registered on Faable'), { code })
    )
    t.is(err?.code, 'domain_unlinked', code)
    t.is(err?.status, 409)
    t.regex(err!.message, /linked to no app/)
    t.regex(
      err!.message,
      /faable deploy domains attach app\.ciapol\.com --app app_web/
    )
  }
})

test('add on a domain of another app of the project names that app', async t => {
  const err = await add_conflict_hint(
    api(ROWS),
    TEAM,
    'api.ciapol.com',
    'app_web',
    Object.assign(new Error('x'), { code: 'domain_taken' })
  )
  t.is(err?.code, 'domain_taken')
  t.regex(err!.message, /attached to app_api/)
})

test('add: another project, or another error, keeps the api error', async t => {
  t.is(
    await add_conflict_hint(
      api(ROWS),
      TEAM,
      'elsewhere.com',
      'app_web',
      Object.assign(new Error('x'), { code: 'domain_taken' })
    ),
    undefined
  )
  t.is(
    await add_conflict_hint(
      api(ROWS),
      TEAM,
      'app.ciapol.com',
      'app_web',
      Object.assign(new Error('x'), { code: 'domain_invalid' })
    ),
    undefined
  )
})
