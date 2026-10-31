import type { FaableTask } from '../../../api/FaableApi'

const DONE = new Set(['succeeded', 'failed', 'timed_out', 'canceled'])
const POLL_MS = 3000

/** Polls a task until it is done (or the caller's patience runs out). */
export const waitForTask = async (
  get: () => Promise<FaableTask>,
  opts: {
    sleep?: (ms: number) => Promise<void>
    onStatus?: (s: string) => void
  } = {}
): Promise<FaableTask> => {
  const sleep = opts.sleep ?? (ms => new Promise(r => setTimeout(r, ms)))
  let last = ''
  for (;;) {
    const t = await get()
    if (t.status !== last) opts.onStatus?.(t.status)
    last = t.status
    if (DONE.has(t.status)) return t
    await sleep(POLL_MS)
  }
}
