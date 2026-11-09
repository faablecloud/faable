import type { FaableAuthApi } from '@faable/auth-sdk'
import { CliError } from '../../../lib/errors'

export interface RoleRow {
  id: string
  name: string
  description?: string
  permissions?: { api: string; value: string }[]
}

export interface RolePermissionRow {
  api: string
  api_identifier: string
  api_name: string
  value: string
  description?: string
}

export interface ApiRow {
  id: string
  name: string
  identifier: string
  token_dialect?: string
  rbac?: boolean
  enforce_policies?: boolean
  token_lifetime?: number
  allow_offline_access?: boolean
  skip_consent?: boolean
  include_roles_in_access_token?: boolean
  include_teams_in_access_token?: boolean
  include_roles_in_id_token?: boolean
  include_teams_in_id_token?: boolean
  permissions?: { value: string; description?: string }[]
}

const first_page = async <T>(paginator: any): Promise<T[]> => {
  const page = await paginator.pass({ pageSize: '100' } as never)
  return (page.results ?? []) as T[]
}

// A role given as its id (`role_…`) or its exact name. A name must match ONE
// role: a write never acts on a partial or ambiguous match.
export const resolve_role_ref = async (
  api: Pick<FaableAuthApi, 'roleList'>,
  ref: string
): Promise<RoleRow> => {
  const value = ref.trim()
  if (/^role_[0-9a-f]{24}$/.test(value)) {
    return (await (api as FaableAuthApi).roleGet(value)) as unknown as RoleRow
  }
  const rows = await first_page<RoleRow>(
    api.roleList({ q: value, pageSize: '100' } as never)
  )
  const exact = rows.filter(r => r.name === value)
  if (exact.length === 0) {
    throw new CliError('not_found', `No role named "${value}" in this tenant.`)
  }
  if (exact.length > 1) {
    throw new CliError(
      'usage',
      `${exact.length} roles are named "${value}" (${exact.map(r => r.id).join(', ')}): pass the role id.`
    )
  }
  return exact[0]
}

// An Api given as its id (`api_…`) or its identifier (the audience URL).
export const resolve_api_ref = async (
  api: Pick<FaableAuthApi, 'apiList' | 'apiGet'>,
  ref: string
): Promise<ApiRow> => {
  const value = ref.trim()
  if (/^api_[0-9a-f]{24}$/.test(value) || value === 'api_management') {
    return (await api.apiGet(value)) as unknown as ApiRow
  }
  const rows = await first_page<ApiRow>(
    api.apiList({ identifier: value, pageSize: '100' } as never)
  )
  const exact = rows.filter(r => r.identifier === value)
  if (exact.length === 0) {
    throw new CliError(
      'not_found',
      `No API with identifier ${value} in this tenant (faable auth apis list).`
    )
  }
  return exact[0]
}
