import { Writable } from 'stream'
import { FaableApi, FaableDeployment } from '../../../api/FaableApi'
import { log } from '../../../log'

const POLL_INTERVAL_MS = 4000
// Queue wait + build must fit here; the server's own stops (Job deadline
// 30min, abandoned janitor 60min) resolve the deployment first in practice.
const FOLLOW_TIMEOUT_MS = 45 * 60 * 1000

const wait = (ms: number) => new Promise(r => setTimeout(r, ms))

/** The clone the platform created to retry this failed build, if any. */
const retry_of = (
  deployment: FaableDeployment | null
): { id: string; to: string } | null => {
  const retry = deployment?.runtime_fallback_retry
  if (!retry?.deployment_id) return null
  // The api stores the clone as bare hex (a `.lean()` ObjectId).
  const id = retry.deployment_id.startsWith('deployment_')
    ? retry.deployment_id
    : `deployment_${retry.deployment_id}`
  return { id, to: retry.to }
}

/**
 * Follow a remote build until the image handoff: poll the phase and tail the
 * build logs the builder uploads every ~10s (replace semantics → print the
 * suffix beyond what we already showed). Returns on INITIALIZING/READY
 * (image landed — the regular promotion poll takes over); throws on
 * BUILD_ERROR/ERROR with the server-provided reason.
 *
 * One exception to "BUILD_ERROR throws": when the platform already retried
 * the build on the previous Python (`runtime_fallback_retry`, api §12), the
 * failure is not the outcome — the clone's is. Follow the clone instead and
 * return ITS id, so the promotion poll and `--json` speak about the deployment
 * that will go live. Until 2026-10-18 the CLI exited red for a deploy that
 * was about to succeed (backlog §379).
 */
const TAIL_CHARS = 200

/**
 * The part of `content` not shown yet, given how much was `printed` and the
 * last characters of it (`seen_tail`).
 *
 * Three cases. The same buffer, grown: print from the offset. A buffer that
 * rotated (keep-tail truncation dropped its head) but still holds the tail we
 * showed: print what comes after that tail. A DIFFERENT buffer — the build
 * Job's log replacing the detect Job's — that does not hold it: print it
 * whole. The old rule only knew the first case and "shrank → resync to its
 * length", so the build log started being printed at the detect log's
 * offset, and its head ("📦 installing dependencies…", most of "added 68
 * packages") never reached the terminal (backlog §390, 2026-10-19).
 */
export const unseen = (
  content: string,
  printed: number,
  seen_tail: string
): { text: string } => {
  if (!seen_tail) return { text: content.slice(printed) }
  const at = printed - seen_tail.length
  if (at >= 0 && content.slice(at, printed) === seen_tail) {
    return { text: content.slice(printed) }
  }
  const found = content.lastIndexOf(seen_tail)
  if (found >= 0) return { text: content.slice(found + seen_tail.length) }
  return { text: content }
}

export const follow_remote_build = async (
  api: FaableApi,
  // `let`: a platform retry switches the follow to its clone.
  initial_deployment_id: string,
  // Where the build log goes. stdout for a person; stderr when stdout carries
  // a JSON document (--json, or a program driving the CLI): one build line in
  // front of it and the caller can't parse the outcome — the MCP reported a
  // live deploy as failed that way (arch/deploy/cli-mcp-fallos-2026-10-16-plan.md, F1).
  out: Writable = process.stdout
): Promise<{ id: string }> => {
  let printed = 0
  let last_phase = ''
  let followed_retry = false
  let deployment_id = initial_deployment_id
  const started = Date.now()

  // What we already showed, as its last characters: enough to recognise the
  // same buffer, a rotated one, or a different one.
  let seen_tail = ''
  const tail_logs = async () => {
    try {
      const logs = await api.getDeploymentLogs(deployment_id)
      const content = logs?.content ?? ''
      const fresh = unseen(content, printed, seen_tail)
      if (fresh.text) out.write(fresh.text)
      printed = content.length
      seen_tail = content.slice(-TAIL_CHARS)
    } catch {
      // No logs yet (404) or transient failure — next poll.
    }
  }

  while (Date.now() - started < FOLLOW_TIMEOUT_MS) {
    const deployment = await api.getDeployment(deployment_id).catch(() => null)
    const phase = deployment?.status?.phase ?? ''

    if (phase !== last_phase && phase) {
      log.info(`☁️ Remote build: ${phase}`)
      last_phase = phase
    }

    await tail_logs()

    if (phase === 'BUILD_ERROR' || phase === 'ERROR') {
      const retry = retry_of(deployment)
      if (retry && !followed_retry) {
        followed_retry = true
        log.info(
          `↩️ The default Python failed with your dependencies — the platform is retrying on Python ${retry.to} · ${retry.id}`
        )
        deployment_id = retry.id
        printed = 0
        last_phase = ''
        continue
      }
      const reason = deployment?.status?.reason
      throw new Error(
        `Remote build failed${reason ? `: ${reason}` : ''}`.trim()
      )
    }
    // Image handoff done: the controller claimed it (INITIALIZING) or it is
    // already live (READY) — the promotion poll takes over from here.
    if (phase === 'INITIALIZING' || phase === 'READY') {
      await tail_logs()
      return { id: deployment_id }
    }

    await wait(POLL_INTERVAL_MS)
  }

  throw new Error(
    'Timed out waiting for the remote build. Check the dashboard for its status.'
  )
}
