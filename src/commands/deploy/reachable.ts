// A promoted deployment is not yet a URL that answers: the edge picks up a
// new app's route a little later, and until then it says `APP_NOT_FOUND`
// (header `x-faable-error`, cacheable for 120 s). On 2026-10-16 a deploy
// reported `outcome: live` and the URL gave 404 for about a minute — an agent
// checking it right away would conclude the deploy was broken
// (arch/deploy/cli-mcp-fallos-2026-10-16-plan.md, F9).
//
// Only the edge's own "no app here" counts as not served: an app is free to
// answer 404 (or anything) on `/`, and that is its answer, not ours.

const NOT_FOUND = 'APP_NOT_FOUND'

export interface ReachableDeps {
  fetch?: (url: string, init: Parameters<typeof fetch>[1]) => Promise<Response>
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

// FAABLE_REACHABLE_TIMEOUT_MS: how long to wait for the edge (default 120 s);
// `0` skips the check — a stub API in tests, or a caller that only wants the
// deployment's phase.
export const reachable_timeout_ms = (
  env: Record<string, string | undefined> = process.env
): number => {
  const raw = env.FAABLE_REACHABLE_TIMEOUT_MS
  const n = raw === undefined || raw === '' ? 120_000 : Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : 120_000
}

/**
 * Wait until `url` is served by the app rather than the edge's "no app here".
 * True as soon as it is; false when `timeout_ms` runs out (the deploy is
 * still live — the route is just late). Never throws: a failed request is one
 * more "not yet".
 */
export const wait_reachable = async (
  url: string,
  timeout_ms: number,
  deps: ReachableDeps = {}
): Promise<boolean> => {
  const fetch_ = deps.fetch ?? fetch
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise(r => setTimeout(r, ms)))
  const now = deps.now ?? Date.now
  const deadline = now() + timeout_ms
  for (;;) {
    try {
      // The not-found answer is cacheable: bust it, or we would read our own
      // first answer back for two minutes.
      const probe = `${url}${url.includes('?') ? '&' : '?'}_faable_probe=${now()}`
      const res = await fetch_(probe, {
        method: 'GET',
        redirect: 'manual',
        headers: { 'cache-control': 'no-cache' }
      })
      if (res.headers.get('x-faable-error') !== NOT_FOUND) return true
    } catch {
      // not reachable yet
    }
    if (now() >= deadline) return false
    await sleep(3_000)
  }
}
