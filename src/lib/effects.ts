// What each CLI command does to Faable — the one place it is written down.
//
//   read         only reads (it may write files HERE: `volumes get`, `users export`)
//   write        changes something in Faable that can be changed back
//   destructive  deletes or overwrites what cannot be brought back, or breaks
//                something at once (a rotated secret)
//   local        changes only this machine's CLI state (session, active project)
//
// `faable commands` publishes it, the read-only mode refuses everything that
// is not `read` or `local` before any request (FAABLE_READONLY), and the MCP
// catalog has to agree with it (src/mcp/effects.test.ts). A command missing
// from here fails src/lib/effects.test.ts: a new command declares what it does.

export type Effect = 'read' | 'write' | 'destructive' | 'local'

export interface EffectRule {
  // The most a call can do — what the catalog shows.
  effect: Effect
  // When the effect depends on the arguments: what this call does.
  of?: (argv: Record<string, any>) => Effect
  // For the catalog, in words: when the call is only a read.
  read_when?: string
}

const R: EffectRule = { effect: 'read' }
const W: EffectRule = { effect: 'write' }
const D: EffectRule = { effect: 'destructive' }
const L: EffectRule = { effect: 'local' }

// `--add` / `--rm` change; without them the command lists.
const lists_unless_add_rm: EffectRule = {
  effect: 'write',
  of: a => (has(a.add) || has(a.rm) ? 'write' : 'read'),
  read_when: 'without --add or --rm'
}

const has = (v: unknown) =>
  v !== undefined && v !== false && !(Array.isArray(v) && v.length === 0)

export const EFFECTS: Record<string, EffectRule> = {
  'deploy launch': W,
  'deploy apps list': R,
  'deploy apps get': R,
  'deploy apps create': W,
  'deploy apps set': W,
  'deploy apps rm': D,
  // No app: the catalogue. `restore` with no installation: what can be
  // restored.
  'deploy install': {
    effect: 'write',
    of: a =>
      !a.app || (a.app === 'restore' && !a.installation) ? 'read' : 'write',
    read_when: 'without <app>, or `restore` without <installation>'
  },
  'deploy github repos': R,
  'deploy secrets list': R,
  'deploy secrets set': W,
  'deploy secrets rm': D,
  'deploy domains list': R,
  'deploy domains add': W,
  'deploy domains attach': W,
  'deploy domains check': R,
  'deploy domains redirect': W,
  'deploy domains rm': D,
  'deploy waf list': R,
  'deploy waf block': W,
  'deploy waf sink': W,
  'deploy waf monitor': W,
  'deploy waf allow': W,
  'deploy waf limit': W,
  'deploy waf rm': W,
  'deploy waf add': W,
  'deploy logs': R,
  'deploy status': R,
  // Runs anything, against the live volumes and variables.
  'deploy run': W,
  'deploy schedule list': R,
  'deploy schedule add': W,
  'deploy schedule enable': W,
  'deploy schedule disable': W,
  'deploy schedule rm': D,
  'deploy databases list': R,
  'deploy databases info': R,
  // Creates a billed database (idempotent: a second call finds it).
  'deploy databases create': W,
  'deploy volumes list': R,
  'deploy volumes ls': R,
  'deploy volumes get': R,
  // To the trash: --undo brings it back for 7 days.
  'deploy volumes rm': W,
  'deploy volumes backups': R,
  'deploy volumes backup': W,
  'deploy volumes restore': D,
  'deploy volumes clone': D,
  'deploy volumes export': R,
  'deploy volumes import': D,
  'deploy volumes put': D,
  'deploy traffic': R,
  'deploy usage': R,
  'deploy quota': R,
  'deploy list': R,
  'deploy deployments': R,
  'deploy inspect': R,
  'deploy open': R,
  'deploy trigger': W,
  'deploy redeploy': W,
  'deploy cancel': W,
  'deploy link': W,

  'auth users list': R,
  'auth users get': R,
  'auth users diagnose': R,
  'auth users update': W,
  'auth users suspend': W,
  'auth users reinstate': W,
  'auth users set-password': W,
  'auth users password-setup': W,
  'auth users tickets list': R,
  'auth users tickets revoke': W,
  'auth users roles': lists_unless_add_rm,
  'auth users permissions': R,
  'auth users import': W,
  'auth users export': R,
  'auth roles list': R,
  'auth roles get': R,
  'auth roles create': W,
  'auth roles permissions': lists_unless_add_rm,
  'auth roles rm': D,
  'auth apis list': R,
  'auth apis get': R,
  'auth apis create': W,
  'auth apis update': W,
  'auth actions list': R,
  'auth actions get': R,
  'auth actions create': W,
  'auth actions update': W,
  'auth actions rm': D,
  'auth clients list': R,
  'auth clients get': R,
  'auth clients create': W,
  'auth clients update': W,
  'auth clients rm': D,
  'auth logs list': R,
  'auth logs get': R,
  'auth sessions list': R,
  'auth sessions revoke': W,
  'auth connections list': R,
  'auth webhooks list': R,
  'auth webhooks get': R,
  'auth webhooks create': W,
  'auth webhooks update': W,
  'auth webhooks test': W,
  // The old secret stays valid 24 h.
  'auth webhooks rotate-secret': W,
  'auth webhooks rm': D,
  'auth email-subscriptions list': R,
  'auth email-subscriptions create': W,
  'auth email-subscriptions update': W,
  'auth email-subscriptions rm': D,
  'auth accounts list': R,
  'auth use': L,

  'challenge sites list': R,
  'challenge sites create': W,
  'challenge sites update': W,
  'challenge sites delete': D,
  // The old secret stops working at once.
  'challenge sites rotate-secret': D,
  'challenge usage': R,

  'project list': R,
  'project use': L,
  'project clear': L,
  'project current': R,
  'organization list': R,
  'organization get': R,
  'organization create': W,
  'organization projects add': W,
  'organization projects rm': W,
  'organization admins add': W,
  'organization admins rm': W,

  login: L,
  logout: L,
  whoami: R,
  commands: R,
  // Serves tools; each tool call is a CLI run of its own, governed by its
  // own command's effect.
  mcp: R,
  // Writes the skill on this machine (~/.claude/skills or the project).
  'agent install': L,
  'agent skill': R,
  upgrade: L,
  link: W
}

export const effect_of = (path: string, argv: Record<string, any> = {}) => {
  const rule = EFFECTS[path]
  if (!rule) return undefined
  return rule.of ? rule.of(argv) : rule.effect
}
