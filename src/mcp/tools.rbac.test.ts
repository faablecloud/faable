import test from 'ava'
import { TOOLS } from './tools'

const tool = (name: string) => TOOLS.find(t => t.name === name)!

test('RBAC: the hosted server reads roles but never writes them', t => {
  for (const name of [
    'list_auth_roles',
    'get_auth_role',
    'get_auth_user_access',
    'list_auth_apis'
  ]) {
    t.falsy(tool(name).local_only, name)
    t.falsy(tool(name).write, name)
  }
  for (const name of [
    'create_auth_role',
    'update_auth_role_permissions',
    'update_auth_user_roles',
    'create_auth_api',
    'update_auth_api'
  ]) {
    t.true(tool(name).write, name)
    t.true(tool(name).local_only, name)
  }
})

test('update_auth_api passes only the settings given, off as --no-<flag>', t => {
  t.deepEqual(
    tool('update_auth_api').flags({
      api: 'https://api.example.com',
      token_lifetime: 3600,
      include_roles_in_access_token: true,
      skip_consent: false,
      project: 'project_1'
    }),
    [
      'https://api.example.com',
      '--token-lifetime',
      '3600',
      '--no-skip-consent',
      '--include-roles-in-access-token',
      '--project',
      'project_1'
    ]
  )
})

test('API token_lifetime: the MCP refuses what the Auth API refuses', t => {
  const lifetime = (tool('update_auth_api').input as any).token_lifetime
  t.true(lifetime.safeParse(3600).success)
  for (const bad of [59, 2592001, 3600.5])
    t.false(lifetime.safeParse(bad).success)
})
