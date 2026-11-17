import type {
  FaableApi,
  FaableCatalogBlueprint,
  FaableInstallation
} from '../../api/FaableApi'
import { CliError } from '../../lib/errors'

// The pure part of `faable deploy install` (install.ts): no api client, no
// config, so the tests import it without the CLI's runtime.

/** `--input title="My site"` (repeatable) → { title: 'My site' }. */
export const parse_inputs = (raw: string[] = []): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const item of raw) {
    const at = item.indexOf('=')
    if (at < 1) {
      throw new CliError(
        'usage',
        `--input ${item}: use name=value (e.g. --input title="My site").`
      )
    }
    out[item.slice(0, at).trim()] = item.slice(at + 1)
  }
  return out
}

/** The fields the blueprint requires that `inputs` leaves empty. */
export const missing_fields = (
  bp: FaableCatalogBlueprint,
  inputs: Record<string, string>
) => bp.create_form.filter(f => f.required && !inputs[f.name]?.trim())

/** What `faable deploy install` (no app) prints: one line per app. */
export const catalog_lines = (catalog: FaableCatalogBlueprint[]): string[] =>
  catalog.map(bp => {
    const fields = bp.create_form
      .map(f => `${f.name}${f.required ? '' : '?'}`)
      .join(', ')
    const tiers = bp.database?.tiers.length
      ? ` · database ${bp.database.tiers.join('/')}`
      : ''
    return `${bp.slug.padEnd(14)} ${bp.name} — ${bp.plans.join(', ')}${tiers} · --input ${fields || '(none)'}`
  })

export interface InstallWaitResult {
  state: string
  done: boolean
  ok: boolean
  error?: string | null
}

/**
 * Poll an installation until it is ready or failed, or `timeout_s` passes
 * (the install goes on on the platform: wait again, or watch the dashboard).
 */
export const wait_for_installation = async (
  api: Pick<FaableApi, 'getInstallation'>,
  inst: { id: string; team: string },
  opts: {
    timeout_s: number
    sleep?: (ms: number) => Promise<void>
    now?: () => number
    poll_ms?: number
  }
): Promise<InstallWaitResult> => {
  const sleep =
    opts.sleep ?? ((ms: number) => new Promise(r => setTimeout(r, ms)))
  const now = opts.now ?? Date.now
  const until = now() + opts.timeout_s * 1000
  let last: FaableInstallation | undefined
  for (;;) {
    last = await api.getInstallation(inst.id, inst.team)
    if (last.state === 'ready') return { state: 'ready', done: true, ok: true }
    if (last.state === 'failed') {
      return { state: 'failed', done: true, ok: false, error: last.error }
    }
    if (now() >= until) {
      return { state: last.state, done: false, ok: false }
    }
    await sleep(opts.poll_ms ?? 5000)
  }
}
