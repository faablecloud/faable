import { version } from '../config'

// What the CLI says it is, in `x-faable-client` on every request — to the
// Deploy API (base_client.ts) and to the auth server (auth.ts) alike. The api
// tags its request log by the name before the `/`, so traffic from the CLI —
// and from the MCP server driving it — can be counted apart.
//
// `<name>/<version>`. No commit: the CLI has no release SHA constant, and a
// dev build (`0.0.0-development`) is identifiable as such by the version
// alone. A `+suffix` would be read as a commit sha, so the driver is told by
// the name, not by a suffix. auth caps the version segment at 32 chars.
//
// FAABLE_CLIENT_NAME: who drives this CLI when it isn't a person. The Faable
// MCP server sets `faable-mcp`. Only `faable-*` names: anything else is
// ignored rather than letting an environment impersonate another client.
export const client_name = (
  env: Record<string, string | undefined> = process.env
): string => {
  const name = env.FAABLE_CLIENT_NAME?.trim().toLowerCase() ?? ''
  return /^faable-[a-z0-9-]{1,24}$/.test(name) ? name : 'faable-cli'
}

export const CLI_CLIENT = `${client_name()}/${version}`
