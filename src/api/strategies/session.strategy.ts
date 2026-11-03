import { FaableConfig } from '../../lib/CredentialsStore'
import { isTokenLive, loadLiveCredentials } from '../session'
import { AuthStrategyBuilder } from './types'

// The `faable login` session, checked on every request instead of once per
// command: a command that waits longer than the access token lives — a
// volume restore or clone, `deploy run --timeout 3600` — used to die halfway
// with «session expired» (2026-11-03, a clone of a WordPress). While the
// token is live nothing is read; when it is not, ONE refresh is in flight and
// every request of that moment waits for it: two refreshes with the same
// refresh token could have the second one revoke the session.
export const session_strategy: AuthStrategyBuilder<{
  token: string
  load?: () => Promise<FaableConfig | undefined>
}> = ({ token, load = () => loadLiveCredentials() }) => {
  let current = token
  let inflight: Promise<void> | null = null
  return {
    headers: async () => {
      if (!isTokenLive(current)) {
        inflight ??= load()
          .then(c => {
            if (c?.token) current = c.token
          })
          .finally(() => {
            inflight = null
          })
        await inflight
      }
      return { Authorization: `Bearer ${current}` }
    }
  }
}
