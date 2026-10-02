import axios from "axios";
import { CLI_CLIENT } from "./client_id";

// FAABLE_API_URL: point the CLI at another Deploy API frontend (e.g.
// https://deploy.staging.faable.com for staging-gated testing). BASE_URL is
// the legacy name, kept for compatibility.
const BASE_URL =
  process.env.FAABLE_API_URL ||
  process.env.BASE_URL ||
  "https://api.faable.com";

export const create_base_client = () => {
    return axios.create({
        baseURL: BASE_URL,
        timeout: 10000,
        // Who is calling: the api tags its request log by this name.
        headers: { "x-faable-client": CLI_CLIENT }
    });
}
