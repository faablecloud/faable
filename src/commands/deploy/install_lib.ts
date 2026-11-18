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
  // Ready and its URL answers (not the edge's APP_NOT_FOUND, cached 120 s):
  // false when the route was still not out at the end of the wait.
  reachable?: boolean
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

/**
 * The app's name when `--name` is not given: the site title as a slug, as the
 * dashboard derives it ("Café & Co." → cafe-co). The app's address adds a
 * random suffix, so two sites with the same title do not clash.
 */
export const app_name_from_title = (title: string): string => {
  const slug = title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, 50)
    .replace(/-+$/, '')
  if (slug.length >= 3) return slug
  return slug ? `${slug}-site` : 'site'
}

// Same rule as the api's (deploy/domain/Domain.model.ts isValidFqdn).
const FQDN = /^(?=.{4,253}$)((?!-)[a-z0-9-]{1,63}(?<!-)\.)+[a-z]{2,}$/i
const RESERVED = ['faable.link', 'faable.com']

/**
 * What is wrong with `--domain`, before anything is created; null when it is
 * fine. The api checks it again (and that no other project has it).
 */
export const domain_problem = (fqdn: string): string | null => {
  if (!FQDN.test(fqdn)) {
    return `--domain ${fqdn}: give the hostname on its own, like www.example.com — no https:// or path.`
  }
  if (RESERVED.some(r => fqdn === r || fqdn.endsWith(`.${r}`))) {
    return `--domain ${fqdn}: addresses under faable.link and faable.com are assigned by Faable — the site gets one anyway.`
  }
  return null
}

/**
 * `faable deploy install restore`: what can come back — the uninstalled
 * installations whose files and database are still kept. An api without
 * `restorable` (older) leaves every uninstalled one in; the restore says.
 */
export const restorable = (list: FaableInstallation[]) =>
  list.filter(i => i.state === 'retained' && i.restorable !== false)

export const restorable_lines = (list: FaableInstallation[]): string[] =>
  restorable(list).map(i => {
    const where = i.domain ?? i.site_url
    const until = i.restorable_until
      ? `until ${i.restorable_until.slice(0, 10)}`
      : ''
    return [i.name, i.blueprint_slug, i.id, where, until]
      .filter(Boolean)
      .join('  ')
  })

/**
 * The installation to restore, by id or by name. A name may repeat (an app
 * name is reused after an uninstall): the uninstalled one is the one meant,
 * and two uninstalled ones need the id. A reason when none fits.
 */
export const find_restorable = (
  list: FaableInstallation[],
  ref: string
): { inst: FaableInstallation } | { problem: string } => {
  const byId = list.find(
    i => i.id === ref || i.id.replace(/^[a-z]+_/, '') === ref
  )
  const matches = byId ? [byId] : list.filter(i => i.name === ref)
  if (!matches.length) {
    return {
      problem: `No installation "${ref}" in this project. See what can be restored with: faable deploy install restore`
    }
  }
  const retained = restorable(matches)
  if (retained.length === 1) return { inst: retained[0] }
  if (retained.length > 1) {
    return {
      problem: `More than one uninstalled "${ref}": restore it by id (${retained.map(i => i.id).join(', ')}).`
    }
  }
  const gone = matches.find(i => i.state === 'retained')
  if (gone) {
    return {
      problem: `"${ref}" can't be restored any more: its files or its database were deleted (uninstalled with its database, or past its 30 days).`
    }
  }
  return {
    problem: `"${ref}" is ${matches[0].state}: only an uninstalled installation can be restored.`
  }
}
