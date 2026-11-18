import test from 'ava'
import { execFile } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import http from 'node:http'
import { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

// `faable challenge` end to end, through the real entrypoint, against a stub
// of the challenge service (FAABLE_CHALLENGE_URL). The project is passed as an
// id, so the deploy api is never asked; it points at a dead port to prove it.
const exec_file = promisify(execFile)
const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const PROJECT = 'project_65a66419863cb24b65b5bd40'
const SITE = {
  id: 'site_0123456789abcdef01234567',
  project_id: PROJECT,
  name: 'web',
  domains: ['example.com'],
  site_key: 'fcs_pk_abc',
  secret_rotated_at: '2026-11-18T00:00:00.000Z',
  created_at: '2026-11-18T00:00:00.000Z',
  updated_at: '2026-11-18T00:00:00.000Z'
}

const start_challenge = async () => {
  const requests: {
    method?: string
    path: string
    body: string
    auth?: string
  }[] = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', c => (body += c))
    req.on('end', () => {
      requests.push({
        method: req.method,
        path: req.url ?? '/',
        body,
        auth: req.headers.authorization
      })
      const json = (status: number, data?: unknown) => {
        res.statusCode = status
        res.setHeader('content-type', 'application/json')
        res.end(data === undefined ? undefined : JSON.stringify(data))
      }
      const base = `/v1/projects/${PROJECT}`
      if (req.url === `${base}/sites` && req.method === 'GET')
        return json(200, { results: [SITE] })
      if (req.url === `${base}/sites` && req.method === 'POST') {
        const b = JSON.parse(body)
        if (b.name === 'full') {
          return json(402, {
            error: 'plan_required',
            message:
              'Your free plan includes 1 Faable Challenge site. Upgrade the project to add more.'
          })
        }
        return json(201, { ...SITE, ...b, secret: 'fcs_sk_new' })
      }
      if (req.url === `${base}/sites/${SITE.id}` && req.method === 'DELETE') {
        res.statusCode = 204
        return res.end()
      }
      if (req.url === `${base}/sites/${SITE.id}/secret`)
        return json(200, { ...SITE, secret: 'fcs_sk_rotated' })
      if (req.url === `${base}/usage`) {
        return json(200, {
          month: '2026-11',
          issued: 10,
          answered: 9,
          verified: 8,
          verify_failed: 1,
          sites: 1,
          plan: { tier: 'free', verifications_month: 1000, sites: 1 }
        })
      }
      json(404, { error: 'site_not_found' })
    })
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => server.close()
  }
}

const run = async (args: string[], env: Record<string, string>) => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'faable-home-'))
  const base = { ...process.env }
  for (const name of [
    'FAABLE_TOKEN',
    'FAABLE_API_KEY',
    'FAABLE_PROJECT',
    'GITHUB_ACTIONS'
  ])
    delete base[name]
  try {
    const { stdout, stderr } = await exec_file(
      process.execPath,
      ['--import', 'tsx', path.join(src, 'index.ts'), ...args],
      {
        cwd: path.resolve(src, '..'),
        env: {
          ...base,
          HOME: home,
          NO_COLOR: '1',
          FAABLE_NONINTERACTIVE: '1',
          FAABLE_TOKEN: 'stub-token',
          FAABLE_API_URL: 'http://127.0.0.1:9',
          ...env
        }
      }
    )
    return { code: 0, stdout, stderr }
  } catch (error) {
    const f = error as { code?: number; stdout?: string; stderr?: string }
    return { code: f.code ?? 1, stdout: f.stdout ?? '', stderr: f.stderr ?? '' }
  }
}

const error_of = (stderr: string) =>
  JSON.parse(stderr.trim().split('\n').pop() ?? '{}').error

test('sites create: the secret is in the output, once; the body is name + domains', async t => {
  const ch = await start_challenge()
  try {
    const { code, stdout } = await run(
      [
        'challenge',
        'sites',
        'create',
        '--name',
        'shop',
        '-d',
        'shop.example.com',
        '-d',
        'example.org',
        '--project',
        PROJECT,
        '--json'
      ],
      { FAABLE_CHALLENGE_URL: ch.url }
    )
    t.is(code, 0)
    t.is(JSON.parse(stdout).secret, 'fcs_sk_new')
    t.is(ch.requests.length, 1)
    t.is(ch.requests[0].auth, 'Bearer stub-token')
    t.deepEqual(JSON.parse(ch.requests[0].body), {
      name: 'shop',
      domains: ['shop.example.com', 'example.org']
    })
  } finally {
    ch.close()
  }
})

test("sites create over the plan's limit: plan_required with the service's sentence", async t => {
  const ch = await start_challenge()
  try {
    const { code, stdout, stderr } = await run(
      [
        'challenge',
        'sites',
        'create',
        '--name',
        'full',
        '-d',
        'a.com',
        '--project',
        PROJECT
      ],
      { FAABLE_CHALLENGE_URL: ch.url }
    )
    t.is(code, 1)
    t.is(stdout, '')
    const e = error_of(stderr)
    t.is(e.code, 'plan_required')
    t.regex(e.message, /Upgrade the project/)
  } finally {
    ch.close()
  }
})

test('sites delete / rotate-secret without --yes: refused, nothing written', async t => {
  const ch = await start_challenge()
  try {
    for (const verb of ['delete', 'rotate-secret']) {
      const { code, stderr } = await run(
        ['challenge', 'sites', verb, 'web', '--project', PROJECT],
        { FAABLE_CHALLENGE_URL: ch.url }
      )
      t.is(code, 1, verb)
      t.is(error_of(stderr).code, 'confirmation_required', verb)
    }
    t.deepEqual(
      ch.requests.filter(r => r.method !== 'GET'),
      []
    )
    // With --yes it goes through, by name.
    const { code, stdout } = await run(
      [
        'challenge',
        'sites',
        'rm',
        'web',
        '--yes',
        '--project',
        PROJECT,
        '--json'
      ],
      { FAABLE_CHALLENGE_URL: ch.url }
    )
    t.is(code, 0)
    t.deepEqual(JSON.parse(stdout), { deleted: true, id: SITE.id, name: 'web' })
    t.truthy(
      ch.requests.find(
        r => r.method === 'DELETE' && r.path.endsWith(`/sites/${SITE.id}`)
      )
    )
  } finally {
    ch.close()
  }
})

test('sites list and usage answer as JSON for scripts and the MCP', async t => {
  const ch = await start_challenge()
  try {
    const list = await run(
      ['challenge', 'sites', 'list', '--project', PROJECT, '--json'],
      { FAABLE_CHALLENGE_URL: ch.url }
    )
    t.is(list.code, 0)
    const page = JSON.parse(list.stdout)
    t.is(page.object, 'list')
    t.is(page.data[0].site_key, 'fcs_pk_abc')
    const usage = await run(
      ['challenge', 'usage', '--project', PROJECT, '--json'],
      { FAABLE_CHALLENGE_URL: ch.url }
    )
    t.is(usage.code, 0)
    t.like(JSON.parse(usage.stdout), {
      project: PROJECT,
      verified: 8,
      plan: { verifications_month: 1000 }
    })
  } finally {
    ch.close()
  }
})

test('a deploy API key is refused before reaching the service', async t => {
  const ch = await start_challenge()
  try {
    const { code, stderr } = await run(
      ['challenge', 'sites', 'list', '--project', PROJECT, '--json'],
      { FAABLE_CHALLENGE_URL: ch.url, FAABLE_TOKEN: '', FAABLE_API_KEY: 'k' }
    )
    t.is(code, 1)
    t.is(error_of(stderr).code, 'apikey_session')
    t.is(ch.requests.length, 0)
  } finally {
    ch.close()
  }
})
