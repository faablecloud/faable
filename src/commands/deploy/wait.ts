import type { FaableApi } from '../../api/FaableApi'

// The phases a deployment does not leave on its own. READY is the good one.
export const TERMINAL_PHASES = new Set([
  'READY',
  'ERROR',
  'BUILD_ERROR',
  'CANCELED',
  'SUPERSEDED'
])
const FAILED_PHASES = new Set(['ERROR', 'BUILD_ERROR'])

export interface WaitResult {
  deployment_id: string
  phase: string | null
  // True when it reached a terminal phase; false when --timeout ran out first
  // (the build goes on: wait again, or follow it in get_deployment).
  done: boolean
  ok: boolean
  url?: string
  reason?: string
  fault_owner?: 'user' | 'platform' | 'unknown' | null
  error_code?: string | null
}

export interface WaitDeps {
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  poll_ms?: number
}

/**
 * Poll a deployment until it reaches a terminal phase or `timeout_s` passes.
 * On READY the app URL comes back; on a failure, the reason and — where the
 * api has it — whose fault it is (GET /deployment/:id/fault).
 */
export const wait_for_deployment = async (
  api: Pick<FaableApi, 'getDeployment' | 'getDeploymentFault'>,
  deployment_id: string,
  opts: { timeout_s: number; app_url?: string },
  deps: WaitDeps = {}
): Promise<WaitResult> => {
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise(r => setTimeout(r, ms)))
  const now = deps.now ?? Date.now
  const poll = deps.poll_ms ?? 5_000
  const deadline = now() + opts.timeout_s * 1000

  for (;;) {
    const d: any = await api.getDeployment(deployment_id)
    const phase: string | null = d?.status?.phase ?? null
    if (phase && TERMINAL_PHASES.has(phase)) {
      const result: WaitResult = {
        deployment_id,
        phase,
        done: true,
        ok: phase === 'READY'
      }
      if (phase === 'READY' && opts.app_url) result.url = opts.app_url
      if (phase !== 'READY' && d?.status?.reason) {
        result.reason = d.status.reason
      }
      if (FAILED_PHASES.has(phase)) {
        const fault = await api
          .getDeploymentFault(deployment_id)
          .catch(() => undefined)
        if (fault) {
          result.fault_owner = fault.fault_owner
          result.error_code = fault.error_code
        }
      }
      return result
    }
    if (now() >= deadline) {
      return { deployment_id, phase, done: false, ok: false }
    }
    await sleep(Math.min(poll, Math.max(0, deadline - now())))
  }
}

export const app_url = (url?: string | null) =>
  url ? (url.startsWith('http') ? url : `https://${url}`) : undefined
