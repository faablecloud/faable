import type { FaableAuthApi } from '@faable/auth-sdk'
import { ConnectionRef, resolve_connection } from '../clients/login_methods'

// A connection by id or by name (case-insensitive), from the whole list: a
// tenant has a handful, and a name two of them share is refused, not guessed.
export const find_connection = async (
  api: Pick<FaableAuthApi, 'connectionList'>,
  ref: string
): Promise<ConnectionRef & { enabled?: boolean }> => {
  const all = (await api.connectionList().all()) as any[]
  return resolve_connection(all, ref)
}
