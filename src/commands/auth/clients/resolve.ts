import type { FaableAuthApi } from '@faable/auth-sdk'

// Accept either the resource id (the /client/:id param) or the OAuth
// `client_id`. The direct lookup rejects a non-resource id with 400 (schema
// format) or 404 — on either, fall back to a search (the management list is
// searchable by client_id) and use a single exact match.
export const resolve_client = async (api: FaableAuthApi, id: string) => {
  try {
    return await api.clientGet(id)
  } catch (e) {
    const status = (e as { response?: { status?: number } })?.response?.status
    if (status !== 404 && status !== 400) throw e
    const candidates = await api.clientList({ q: id, pageSize: 10 }).pass()
    const exact = candidates.results.filter(c => c.client_id === id)
    if (exact.length === 1) return exact[0]
    throw new Error(`Client not found: ${id}`, { cause: e })
  }
}
