import { FaableAuthApi, authBearer, type ApiParams } from "@faable/auth-sdk";
import os from "os";
import { version } from "../config";

// The CLI talks to the Faable tenant's auth server through the same SDK the
// rest of the platform uses. It used to be a bare axios instance, which meant
// every call landed in the tenant's traffic as "not identified" — the SDK
// stamps `x-faable-client`, and the value below makes it say who this really
// is instead of `auth-sdk`.
//
// Two clients, because there are two kinds of call:
//  - anonymous: the device flow and the refresh grant. A public client, no
//    secret, no token yet. POSTs are never retried by the fetcher, which is
//    what the device polling needs — every `authorization_pending` is an
//    error the loop expects, not one to replay.
//  - bearer: `/me` and everything `faable auth` does, with the token the user
//    already holds. The strategy asks for the token on every request, so
//    whatever `loadLiveCredentials` refreshed is what goes on the wire.
export const AUTH_DOMAIN = "https://faable.auth.faable.link";
export const CLIENT_ID = "c879023b-e34f-4b0c-a262-210e556bc2e4";

// `<name>/<version>`. No commit: the CLI has no release SHA constant, and a
// dev build (`0.0.0-development`) is identifiable as such by the version
// alone. auth caps this segment at 32 chars.
export const CLI_CLIENT = `faable-cli/${version}`;

// No `x-faable-instance`: the SDK's default is `${HOSTNAME}:${pid}`, which on
// a laptop is the user's machine name in our audit log. An empty string
// suppresses the header (the helper drops falsy parts).
const clientInfo = { client: CLI_CLIENT, instance: "" };

type AuthApiOptions = {
  domain?: string;
  // Target tenant for the management API (`x-faableauth-account`): `faable
  // auth --account`. The default is whatever `domain` resolves to.
  account?: string;
  // Test seam: an axios adapter, so a test can read what goes on the wire
  // without a server.
  fetcher?: ApiParams["fetcher"];
};

export const createAnonymousAuthApi = ({
  domain = AUTH_DOMAIN,
  fetcher,
}: AuthApiOptions = {}) =>
  FaableAuthApi.create({ domain, clientInfo, ...(fetcher ? { fetcher } : {}) });

export const createBearerAuthApi = (
  token: string | (() => string | undefined | Promise<string | undefined>),
  { domain = AUTH_DOMAIN, account, fetcher }: AuthApiOptions = {},
) =>
  FaableAuthApi.create({
    domain,
    ...(account ? { headers: { account_id: account } } : {}),
    authStrategy: authBearer,
    auth: { token },
    clientInfo,
    ...(fetcher ? { fetcher } : {}),
  });

const anonymous = createAnonymousAuthApi();

const PLATFORM_LABELS: Record<string, string> = {
  darwin: "macOS",
  win32: "Windows",
  linux: "Linux",
};

// Human-friendly device name shown on the auth confirm page so the user can
// recognise which device they are authorising, e.g. "marcs-mbp (macOS)".
function deviceName() {
  const platform = PLATFORM_LABELS[os.platform()] || os.platform();
  return `${os.hostname()} (${platform})`;
}

export type DeviceCode = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
};

export type TokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
};

export async function getDeviceCode(): Promise<DeviceCode> {
  return anonymous.fetcher.post<DeviceCode>(`/oauth/device/code`, {
    client_id: CLIENT_ID,
    scope: "openid email profile offline_access",
    device_name: deviceName(),
  });
}

export async function getDeviceToken(device_code: string): Promise<TokenResponse> {
  return anonymous.fetcher.post<TokenResponse>(`/oauth/token`, {
    device_code,
    client_id: CLIENT_ID,
    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
  });
}

// Validate a device-flow access token against the Faable Auth server. The token
// is issued by the auth server, so it must be introspected there — NOT against
// the deploy API (api.faable.com), which has no /me route and would 404.
export async function getMe(access_token: string) {
  return createBearerAuthApi(access_token).fetcher.get<{
    email: string;
    id: string;
  }>(`/me`);
}

// Exchange a refresh token for a fresh access token (and a rotated refresh
// token). The CLI is a public client, so no client_secret is required.
export async function refreshToken(refresh_token: string): Promise<TokenResponse> {
  return anonymous.fetcher.post<TokenResponse>(`/oauth/token`, {
    grant_type: "refresh_token",
    client_id: CLIENT_ID,
    refresh_token,
  });
}
