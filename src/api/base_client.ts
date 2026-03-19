import axios from "axios";

const BASE_URL = process.env.BASE_URL || "https://api.faable.com"
export const base_client = axios.create({
    baseURL: BASE_URL,
    timeout: 10000
});