import axios from "axios";
import os from "os";


const api = axios.create({baseURL:"https://faable.auth.faable.link"})
const CLIENT_ID = "c879023b-e34f-4b0c-a262-210e556bc2e4"

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

export async function getDeviceCode() {
  const res = await api.post<{
    device_code: string;
    user_code: string;
    verification_uri: string;
    verification_uri_complete: string;
    expires_in: number;
    interval: number;
  }>(`/oauth/device/code`, {
    client_id: CLIENT_ID,
    scope: "openid email profile offline_access",
    device_name: deviceName(),
  });
  return res.data;
}

export async function getDeviceToken(device_code: string) {
  const res = await api.post<{
    access_token: string;
    token_type: string;
    expires_in: number;
    refresh_token?: string;
  }>(`/oauth/token`, { device_code, client_id:CLIENT_ID, grant_type:"urn:ietf:params:oauth:grant-type:device_code" });
  return res.data;
}

// Validate a device-flow access token against the Faable Auth server. The token
// is issued by the auth server, so it must be introspected there — NOT against
// the deploy API (api.faable.com), which has no /me route and would 404.
export async function getMe(access_token: string) {
  const res = await api.get<{ email: string; id: string }>(`/me`, {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  return res.data;
}

// Exchange a refresh token for a fresh access token (and a rotated refresh
// token). The CLI is a public client, so no client_secret is required.
export async function refreshToken(refresh_token: string) {
  const res = await api.post<{
    access_token: string;
    token_type: string;
    expires_in: number;
    refresh_token?: string;
  }>(`/oauth/token`, {
    grant_type: "refresh_token",
    client_id: CLIENT_ID,
    refresh_token,
  });
  return res.data;
}
