// What `--type` makes of a new client. `web` is the server-rendered app that
// keeps a secret; `spa` and `native` run where a secret cannot be kept, so they
// are public clients: PKCE, `token_endpoint_auth_method: none`, no secret. The
// create route takes neither field (auth ClientCreate), so the CLI sets them
// with an update right after creating the client.
export const CLIENT_TYPES = ['web', 'spa', 'native'] as const
export type ClientType = (typeof CLIENT_TYPES)[number]

export const is_public_client = (type: ClientType) => type !== 'web'

export const client_type_patch = (
  type: ClientType
): { application_type: string; token_endpoint_auth_method: string } | null =>
  is_public_client(type)
    ? { application_type: type, token_endpoint_auth_method: 'none' }
    : null
