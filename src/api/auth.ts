import axios from "axios";


const api = axios.create({baseURL:"https://faable.auth.faable.link"})
const CLIENT_ID = "c879023b-e34f-4b0c-a262-210e556bc2e4"

export async function getDeviceCode() {
  const res = await api.post<{
    device_code: string;
    user_code: string;
    verification_uri: string;
    expires_in: number;
    interval: number;
  }>(`/oauth/device/code`, {
    client_id: CLIENT_ID,
    scope: "openid email profile offline_access",
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
