/**
 * Environment variables the platform already provides.
 *
 * Two very different failure modes, so they are warned about differently:
 *
 *  - `reserved`: the controller DROPS a user secret with this name before
 *    building the Deployment's env list (controller-deploy
 *    src/k8s/deployment.actions.ts, RESERVED). Setting it is a silent no-op —
 *    the platform value always wins — which is exactly the kind of thing
 *    people spend an afternoon debugging.
 *  - `runtime_default`: the runtime image already exports it
 *    (buildpacks/images/runtime-{node,python}/Dockerfile). A user value DOES
 *    win here, so it is legal — just usually redundant, and occasionally the
 *    reason a production build behaves like a dev one.
 *
 * Mirrored in the dashboard (dashboard components/apps/deploy/secrets/
 * managed_names.ts) so both surfaces say the same thing. Keep in sync.
 */

export type ManagedKind = 'reserved' | 'runtime_default'

const DOCS_BASE = 'https://faable.com/docs/deploy/environment'

export const MANAGED_DOCS_URL: Record<ManagedKind, string> = {
  reserved: `${DOCS_BASE}#reserved-names`,
  runtime_default: `${DOCS_BASE}#runtime-defaults`
}

export interface ManagedName {
  kind: ManagedKind
  // Completes the sentence "Faable sets <NAME> …".
  detail: string
}

export const MANAGED_ENV_NAMES: Record<string, ManagedName> = {
  PORT: {
    kind: 'reserved',
    detail: 'to 80 — the port your app must listen on'
  },
  FAABLE_HOST: { kind: 'reserved', detail: "to your app's public host" },
  FAABLE_APP_ID: { kind: 'reserved', detail: 'to this app id' },
  FAABLE_DEPLOY_ID: { kind: 'reserved', detail: "to each deployment's id" },
  FAABLE_RELEASE: {
    kind: 'reserved',
    detail: 'from --release or your latest git tag'
  },
  FAABLE_GIT_COMMIT: {
    kind: 'reserved',
    detail: 'to the commit the deployment was built from'
  },
  FAABLE_GIT_REF: { kind: 'reserved', detail: 'to the deployed git ref' },
  START_COMMAND: {
    kind: 'reserved',
    detail: "to the artifact's start command"
  },
  NODE_ENV: {
    kind: 'runtime_default',
    detail: 'to "production" on Node runtimes'
  },
  PYTHONUNBUFFERED: {
    kind: 'runtime_default',
    detail: 'to "1" on Python runtimes'
  }
}

export const managed_name = (name: string): ManagedName | undefined =>
  MANAGED_ENV_NAMES[name.trim()]

// One line, ready for a warning log. Undefined when the name is the user's
// own business.
export const managed_warning = (name: string): string | undefined => {
  const managed = managed_name(name)
  if (!managed) return undefined
  const key = name.trim()
  const url = MANAGED_DOCS_URL[managed.kind]
  return managed.kind === 'reserved'
    ? `${key} is reserved: your value is ignored. Faable sets it ${managed.detail}. ${url}`
    : `${key} is already set ${managed.detail}; override it only if you mean to. ${url}`
}
