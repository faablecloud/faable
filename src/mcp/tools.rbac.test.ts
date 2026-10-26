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
    'update_auth_user_roles'
  ]) {
    t.true(tool(name).write, name)
    t.true(tool(name).local_only, name)
  }
})
