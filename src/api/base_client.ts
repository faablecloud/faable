import axios from "axios";

const BASE_URL = process.env.BASE_URL || "https://api.faable.com"

export const create_base_client = () => {
    return axios.create({
        baseURL: BASE_URL,
        timeout: 10000
    });
}       