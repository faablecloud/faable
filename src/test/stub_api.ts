import http from 'node:http'
import { AddressInfo } from 'node:net'

// A Deploy API stand-in for the end-to-end tests (machine_mode.test.ts,
// mcp/server.test.ts): FAABLE_API_URL points the CLI here. It records every
// write (method + url) and its body, so a test can say what did — and did
// not — reach the api.

export const APP = {
  id: 'app_test',
  name: 'test-app',
  team: 'project_test',
  url: 'test-app.app.faable.com'
}

export const PROJECT = 'project_65a66419863cb24b65b5bd40'
export const NEW_APP = {
  id: 'app_new',
  name: 'web',
  team: PROJECT.replace('project_', 'team_'),
  url: 'web.app.faable.com'
}

export const start_api = async () => {
  const writes: string[] = []
  const bodies: string[] = []
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://stub')
    const json = (body: unknown) => {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(body))
    }
    if (req.method !== 'GET') {
      writes.push(`${req.method} ${req.url}`)
      let body = ''
      req.on('data', chunk => (body += chunk))
      req.on('end', () => {
        bodies.push(body)
        if (url.pathname === `/app/${APP.id}/deploy`) {
          return json({
            status: 'created',
            commit: 'abc1234def',
            branch: 'main'
          })
        }
        if (url.pathname === '/deployment/deployment_1/redeploy') {
          return json({ id: 'deployment_2', redeploy_of: 'deployment_1' })
        }
        if (url.pathname === '/domain') {
          return json({ id: 'domain_2', fqdn: 'www.new.example.com' })
        }
        // `apps create`: the new app, its link and its first deploy.
        if (req.method === 'POST' && url.pathname === '/app') {
          return json({ ...NEW_APP, name: JSON.parse(body).name })
        }
        if (url.pathname === `/app/${NEW_APP.id}/link-repository`) {
          if (JSON.parse(body).repository === 'acme/taken') {
            res.statusCode = 409
            return json({
              message: 'acme/taken is already linked to app_other',
              code: 'repository_already_linked'
            })
          }
          return json({
            ...NEW_APP,
            repository: 'acme/web',
            github_branch: 'main',
            deploy_trigger: 'webhook'
          })
        }
        if (url.pathname === `/app/${NEW_APP.id}/deploy`) {
          return json({
            status: 'created',
            commit: 'fff0000aaa',
            branch: 'main',
            deployment_id: 'deployment_first'
          })
        }
        json({})
      })
      return
    }
    if (url.pathname === `/app/${APP.id}`) return json(APP)
    if (url.pathname === '/app') return json({ results: [APP], next: null })
    if (url.pathname === `/app/${APP.id}/logs`) {
      return json([
        ['1700000001000000000', 'second'],
        ['1700000000000000000', 'first', 'stdout']
      ])
    }
    if (url.pathname === '/deployment') {
      return json({
        results: [{ id: 'deployment_1', status: { phase: 'BUILD_ERROR' } }],
        next: null
      })
    }
    if (url.pathname === '/deployment/deployment_1/logs') {
      return json({ content: 'one\ntwo\nthree\n', truncated: false })
    }
    if (url.pathname === `/secret/${APP.id}`) {
      return json({
        results: [{ name: 'API_KEY', value: 'secret', related_model: 'app' }],
        next: null
      })
    }
    if (url.pathname === '/domain') {
      return json({
        results: [{ id: 'domain_1', fqdn: 'www.example.com', verified: true }],
        next: null
      })
    }
    res.statusCode = 404
    json({ message: 'not found' })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    writes,
    bodies,
    close: () => server.close()
  }
}
