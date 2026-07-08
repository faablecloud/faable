import { Secret } from '../../../api/FaableApi'
import { SecretPair } from './parse_pairs'

// The mutation endpoint (`/secret/createbatch`) replaces the app's whole
// secret set, so every change is a read-merge-replace over the CURRENT
// app-scoped secrets. GET /secret/:app_id also returns secrets inherited
// from the team profile — those must never be written back through the app
// context (they would be copied down as app secrets), hence the
// related_model filter.

const app_scoped = (existing: Secret[]): SecretPair[] =>
  existing
    .filter(s => s.related_model === 'app')
    .map(s => ({ name: s.name, value: s.value }))

// Upsert `updates` into the app's secrets: existing names are overwritten,
// new names appended. Returns the full set to send to createbatch.
export const merge_app_secrets = (
  existing: Secret[],
  updates: SecretPair[]
): SecretPair[] => {
  const merged = new Map(app_scoped(existing).map(p => [p.name, p.value]))
  for (const { name, value } of updates) {
    merged.set(name, value)
  }
  return [...merged.entries()].map(([name, value]) => ({ name, value }))
}

// Remove one secret by name. Throws when the name is not an app-scoped
// secret — with a dedicated hint when it exists but belongs to the team
// profile (not manageable through the app context).
export const remove_app_secret = (
  existing: Secret[],
  name: string
): SecretPair[] => {
  const app_secrets = app_scoped(existing)
  if (!app_secrets.some(p => p.name === name)) {
    if (existing.some(s => s.related_model === 'profile' && s.name === name)) {
      throw new Error(
        `"${name}" is inherited from the team profile and cannot be removed from the app. Manage team secrets from the dashboard.`
      )
    }
    const names = app_secrets.map(p => p.name).sort().join(', ') || '(none)'
    throw new Error(`Secret "${name}" not found. Existing secrets: ${names}`)
  }
  return app_secrets.filter(p => p.name !== name)
}
